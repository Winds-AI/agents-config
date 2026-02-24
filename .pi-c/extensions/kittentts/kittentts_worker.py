#!/usr/bin/env python3
"""
Persistent KittenTTS ONNX worker for Pi extension.

Protocol: JSON lines over stdin/stdout.
Input:
  {"op":"speak","id":"c1","text":"...","voice":"Bella","speed":1.0,"generation":0}
  {"op":"pause","id":"p1","pause_ms":350,"generation":0}
  {"op":"clear"}
  {"op":"shutdown"}

Output events:
  {"type":"ready","player":"aplay"}
  {"type":"ack","id":"c1"}
  {"type":"synth_done","id":"c1","synth_ms":123}
  {"type":"play_done","id":"c1","synth_ms":123,"play_ms":456}
  {"type":"pause_done","id":"p1","pause_ms":350}
  {"type":"error","id":"c1","stage":"synth|play|input","message":"..."}
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Optional

# ============================================================================
# Configuration (can be overridden by CLI args/environment)
# ============================================================================

DEFAULT_MODEL_REPO_ID = "KittenML/kitten-tts-micro-0.8"
DEFAULT_PLAYER_PRIORITY = ("pw-play", "paplay", "aplay")
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_MAX_TEXT_CHUNK = 400
DEFAULT_TAIL_TRIM_SAMPLES = 5000
DEFAULT_ORT_INTRA_THREADS = max(1, min(os.cpu_count() or 1, 8))
DEFAULT_ORT_INTER_THREADS = 1

TOKEN_RE = re.compile(r"\w+|[^\w\s]")
SENTENCE_SPLIT_RE = re.compile(r"[.!?]+")

IMPORT_ERROR: Optional[Exception] = None
try:
    import espeakng_loader
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from huggingface_hub import hf_hub_download
    from phonemizer.backend import EspeakBackend
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
except Exception as exc:
    IMPORT_ERROR = exc


class TextCleaner:
    def __init__(self) -> None:
        symbols = (
            ["$"]
            + list(';:,.!?¡¿—…"«»"" ')
            + list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
            + list(
                "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ"
            )
        )
        self.word_index_dictionary = {symbol: idx for idx, symbol in enumerate(symbols)}

    def __call__(self, text: str) -> list[int]:
        return [self.word_index_dictionary[char] for char in text if char in self.word_index_dictionary]


def basic_english_tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def ensure_punctuation(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    if cleaned[-1] not in ".!?,;:":
        cleaned += ","
    return cleaned


def chunk_text(text: str, max_len: int = DEFAULT_MAX_TEXT_CHUNK) -> list[str]:
    chunks: list[str] = []
    for sentence in SENTENCE_SPLIT_RE.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_len:
            chunks.append(ensure_punctuation(sentence))
            continue

        temp_chunk = ""
        for word in sentence.split():
            if len(temp_chunk) + len(word) + 1 <= max_len:
                temp_chunk += f" {word}" if temp_chunk else word
                continue

            if temp_chunk:
                chunks.append(ensure_punctuation(temp_chunk.strip()))
            temp_chunk = word

        if temp_chunk:
            chunks.append(ensure_punctuation(temp_chunk.strip()))

    return chunks


def read_env_int(name: str, fallback: int, min_value: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return max(min_value, value)


class KittenOnnxModel:
    def __init__(self, model_repo_id: str, cache_dir: Optional[str] = None) -> None:
        config_path = hf_hub_download(repo_id=model_repo_id, filename="config.json", cache_dir=cache_dir)
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)

        if config.get("type") not in {"ONNX1", "ONNX2"}:
            raise ValueError(f"Unsupported model type: {config.get('type')}")

        model_path = hf_hub_download(repo_id=model_repo_id, filename=config["model_file"], cache_dir=cache_dir)
        voices_path = hf_hub_download(repo_id=model_repo_id, filename=config["voices"], cache_dir=cache_dir)

        self.voice_aliases = {str(k): str(v) for k, v in config.get("voice_aliases", {}).items()}
        self.speed_priors = {str(k): float(v) for k, v in config.get("speed_priors", {}).items()}
        self.voices = self._load_voices(voices_path)
        self.available_voices = tuple(sorted(self.voices.keys()))
        self.text_cleaner = TextCleaner()
        self.phonemizer = self._build_phonemizer()
        self.session = self._build_session(model_path)

    def _build_phonemizer(self) -> EspeakBackend:
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        data_path = espeakng_loader.get_data_path()
        if hasattr(EspeakWrapper, "set_data_path"):
            EspeakWrapper.set_data_path(data_path)
        else:
            setattr(EspeakWrapper, "data_path", data_path)

        return EspeakBackend(language="en-us", preserve_punctuation=True, with_stress=True)

    def _build_session(self, model_path: str) -> ort.InferenceSession:
        intra_threads = read_env_int("KITTENTTS_ORT_INTRA_THREADS", DEFAULT_ORT_INTRA_THREADS)
        inter_threads = read_env_int("KITTENTTS_ORT_INTER_THREADS", DEFAULT_ORT_INTER_THREADS)

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.intra_op_num_threads = intra_threads
        session_options.inter_op_num_threads = inter_threads

        return ort.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )

    def _load_voices(self, voices_path: str) -> dict[str, np.ndarray]:
        voices_npz = np.load(voices_path)
        voices: dict[str, np.ndarray] = {}
        try:
            for voice_name in voices_npz.files:
                voices[voice_name] = np.asarray(voices_npz[voice_name], dtype=np.float32)
        finally:
            voices_npz.close()
        if not voices:
            raise ValueError("Model voices file did not contain any voice embeddings")
        return voices

    def _resolve_voice(self, voice: str) -> str:
        resolved = self.voice_aliases.get(voice, voice)
        if resolved not in self.voices:
            raise ValueError(f"Voice '{voice}' not available. Choices: {', '.join(self.available_voices)}")
        return resolved

    def _effective_speed(self, voice: str, speed: float) -> float:
        prior = self.speed_priors.get(voice, 1.0)
        return float(speed) * prior

    def _prepare_inputs(self, text: str, voice: str, speed: float) -> dict[str, np.ndarray]:
        resolved_voice = self._resolve_voice(voice)
        effective_speed = self._effective_speed(resolved_voice, speed)

        phoneme_items = self.phonemizer.phonemize([text])
        if not phoneme_items:
            raise ValueError("Phonemizer returned no output")
        phoneme_text = " ".join(basic_english_tokenize(phoneme_items[0]))
        tokens = self.text_cleaner(phoneme_text)
        if not tokens:
            raise ValueError("No valid tokens were produced for input text")

        tokens.insert(0, 0)
        tokens.append(0)
        input_ids = np.array([tokens], dtype=np.int64)

        voice_matrix = self.voices[resolved_voice]
        ref_id = min(len(text), voice_matrix.shape[0] - 1)
        style = voice_matrix[ref_id : ref_id + 1]

        return {
            "input_ids": input_ids,
            "style": style,
            "speed": np.array([effective_speed], dtype=np.float32),
        }

    def _generate_single_chunk(self, text: str, voice: str, speed: float) -> np.ndarray:
        onnx_inputs = self._prepare_inputs(text, voice, speed)
        outputs = self.session.run(None, onnx_inputs)
        if not outputs:
            raise RuntimeError("Model inference returned no outputs")

        waveform = np.asarray(outputs[0], dtype=np.float32).reshape(-1)
        if waveform.shape[-1] > DEFAULT_TAIL_TRIM_SAMPLES:
            waveform = waveform[:-DEFAULT_TAIL_TRIM_SAMPLES]
        return waveform

    def generate_to_file(self, text: str, output_path: str, voice: str, speed: float) -> None:
        text_chunks = chunk_text(text)
        if not text_chunks:
            raise ValueError("Cannot synthesize empty text")

        audio_chunks = [self._generate_single_chunk(chunk, voice, speed) for chunk in text_chunks]
        audio = np.concatenate(audio_chunks, axis=-1).astype(np.float32, copy=False)
        sf.write(output_path, audio, DEFAULT_SAMPLE_RATE)


@dataclass
class SpeakJob:
    chunk_id: str
    text: str
    voice: str
    speed: float
    generation: int


@dataclass
class SynthResult:
    job: SpeakJob
    wav_path: str
    synth_ms: int


@dataclass
class PauseJob:
    chunk_id: str
    pause_ms: int
    generation: int


emit_lock = threading.Lock()
state_lock = threading.Lock()
active_generation = 0
stop_event = threading.Event()
plan_queue: "queue.Queue[Optional[SpeakJob | PauseJob]]" = queue.Queue()
play_queue: "queue.Queue[Optional[SynthResult | PauseJob]]" = queue.Queue()


def emit(payload: dict) -> None:
    with emit_lock:
        print(json.dumps(payload), flush=True)


def get_generation() -> int:
    with state_lock:
        return active_generation


def bump_generation() -> int:
    global active_generation
    with state_lock:
        active_generation += 1
        return active_generation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persistent KittenTTS ONNX worker")
    parser.add_argument("--model", default=DEFAULT_MODEL_REPO_ID, help="Hugging Face model repo ID")
    parser.add_argument(
        "--players",
        default=",".join(DEFAULT_PLAYER_PRIORITY),
        help="Comma-separated player command priority list",
    )
    return parser.parse_args()


def pick_player(priority: tuple[str, ...]) -> Optional[str]:
    for candidate in priority:
        if shutil.which(candidate):
            return candidate
    return None


def safe_unlink(path: str) -> None:
    try:
        if os.path.exists(path):
            os.unlink(path)
    except Exception:
        pass


def synth_loop(model: KittenOnnxModel) -> None:
    while not stop_event.is_set():
        try:
            job = plan_queue.get(timeout=0.2)
        except queue.Empty:
            continue

        if job is None:
            break

        if isinstance(job, PauseJob):
            if job.generation != get_generation():
                continue
            play_queue.put(job)
            continue

        if job.generation != get_generation():
            continue

        wav_path: Optional[str] = None
        try:
            fd, wav_path = tempfile.mkstemp(suffix=".wav", prefix="pi-kittentts-")
            os.close(fd)

            synth_start = time.perf_counter()
            model.generate_to_file(job.text, wav_path, job.voice, job.speed)
            synth_ms = int((time.perf_counter() - synth_start) * 1000)

            emit({"type": "synth_done", "id": job.chunk_id, "synth_ms": synth_ms})
            play_queue.put(SynthResult(job=job, wav_path=wav_path, synth_ms=synth_ms))
        except Exception as exc:
            if wav_path:
                safe_unlink(wav_path)
            emit(
                {
                    "type": "error",
                    "id": job.chunk_id,
                    "stage": "synth",
                    "message": str(exc),
                }
            )


def play_file(player: str, wav_path: str) -> tuple[int, str]:
    proc = subprocess.run(
        [player, wav_path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    return proc.returncode, (proc.stderr or "").strip()


def play_loop(player: str) -> None:
    while not stop_event.is_set():
        try:
            item = play_queue.get(timeout=0.2)
        except queue.Empty:
            continue

        if item is None:
            break

        if isinstance(item, PauseJob):
            if item.generation != get_generation():
                continue
            time.sleep(max(item.pause_ms, 0) / 1000.0)
            emit({"type": "pause_done", "id": item.chunk_id, "pause_ms": item.pause_ms})
            continue

        job = item.job
        if job.generation != get_generation():
            safe_unlink(item.wav_path)
            continue

        play_start = time.perf_counter()
        code, stderr = play_file(player, item.wav_path)
        play_ms = int((time.perf_counter() - play_start) * 1000)

        safe_unlink(item.wav_path)

        if code != 0:
            emit(
                {
                    "type": "error",
                    "id": job.chunk_id,
                    "stage": "play",
                    "message": stderr or f"{player} exited with code {code}",
                }
            )
            continue

        emit(
            {
                "type": "play_done",
                "id": job.chunk_id,
                "synth_ms": item.synth_ms,
                "play_ms": play_ms,
            }
        )


def parse_speak(obj: dict) -> Optional[SpeakJob]:
    chunk_id = str(obj.get("id", "")).strip()
    text = str(obj.get("text", "")).strip()
    voice = str(obj.get("voice", "Bella")).strip() or "Bella"
    try:
        speed = float(obj.get("speed", 1.0))
    except (TypeError, ValueError):
        speed = 1.0
    try:
        generation = int(obj.get("generation", get_generation()))
    except (TypeError, ValueError):
        generation = get_generation()

    if not chunk_id or not text:
        return None

    return SpeakJob(
        chunk_id=chunk_id,
        text=text,
        voice=voice,
        speed=speed,
        generation=generation,
    )


def parse_pause(obj: dict) -> Optional[PauseJob]:
    chunk_id = str(obj.get("id", "")).strip()
    try:
        pause_ms = int(obj.get("pause_ms", 0))
    except (TypeError, ValueError):
        pause_ms = 0
    try:
        generation = int(obj.get("generation", get_generation()))
    except (TypeError, ValueError):
        generation = get_generation()

    if not chunk_id:
        return None

    return PauseJob(
        chunk_id=chunk_id,
        pause_ms=max(0, pause_ms),
        generation=generation,
    )


def main() -> int:
    args = parse_args()

    player_priority = tuple(p.strip() for p in args.players.split(",") if p.strip())
    if not player_priority:
        player_priority = DEFAULT_PLAYER_PRIORITY

    if IMPORT_ERROR is not None:
        emit(
            {
                "type": "fatal",
                "message": (
                    "KittenTTS ONNX dependencies missing: "
                    f"{IMPORT_ERROR}. Install: pip install -r .pi/extensions/kittentts/requirements-cpu.txt"
                ),
            }
        )
        return 1

    player = pick_player(player_priority)
    if not player:
        emit(
            {
                "type": "fatal",
                "message": f"No audio player found. Tried: {', '.join(player_priority)}",
            }
        )
        return 1

    try:
        model = KittenOnnxModel(args.model, cache_dir=os.environ.get("HF_HOME"))
    except Exception as exc:
        emit({"type": "fatal", "message": f"Failed to load ONNX model: {exc}"})
        return 1

    synth_thread = threading.Thread(target=synth_loop, args=(model,), daemon=True)
    play_thread = threading.Thread(target=play_loop, args=(player,), daemon=True)
    synth_thread.start()
    play_thread.start()

    emit({"type": "ready", "player": player, "model": args.model})

    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue

            try:
                obj = json.loads(line)
            except Exception as exc:
                emit({"type": "error", "stage": "input", "message": f"Invalid JSON: {exc}"})
                continue

            op = obj.get("op")
            if op == "speak":
                job = parse_speak(obj)
                if not job:
                    emit({"type": "error", "stage": "input", "message": "Invalid speak payload"})
                    continue
                plan_queue.put(job)
                emit({"type": "ack", "id": job.chunk_id})
                continue

            if op == "pause":
                job = parse_pause(obj)
                if not job:
                    emit({"type": "error", "stage": "input", "message": "Invalid pause payload"})
                    continue
                plan_queue.put(job)
                emit({"type": "ack", "id": job.chunk_id})
                continue

            if op == "clear":
                new_generation = bump_generation()
                emit({"type": "cleared", "generation": new_generation})
                continue

            if op == "shutdown":
                break

            emit({"type": "error", "stage": "input", "message": f"Unknown op: {op}"})
    finally:
        stop_event.set()
        plan_queue.put(None)
        play_queue.put(None)
        synth_thread.join(timeout=2.0)
        play_thread.join(timeout=2.0)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
