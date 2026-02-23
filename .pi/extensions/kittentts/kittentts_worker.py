#!/usr/bin/env python3
"""
Persistent KittenTTS worker for Pi extension.

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
import contextlib
import io
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Optional

# ============================================================================
# Configuration (can be overridden by CLI args)
# ============================================================================

DEFAULT_MODEL_REPO_ID = "KittenML/kitten-tts-mini-0.8"
DEFAULT_PLAYER_PRIORITY = ("pw-play", "paplay", "aplay")

try:
    from kittentts import KittenTTS
    IMPORT_ERROR: Optional[Exception] = None
except Exception as exc:
    KittenTTS = None  # type: ignore[assignment]
    IMPORT_ERROR = exc


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
    parser = argparse.ArgumentParser(description="Persistent KittenTTS worker")
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


def synth_loop(model: KittenTTS) -> None:
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
            # Keep stdout/stderr JSON-only for parent protocol handling.
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
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
                "message": f"KittenTTS import failed: {IMPORT_ERROR}. Install: pip install https://github.com/KittenML/KittenTTS/releases/download/0.8/kittentts-0.8.0-py3-none-any.whl",
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
        model = KittenTTS(args.model)
    except Exception as exc:
        emit({"type": "fatal", "message": f"Failed to load KittenTTS model: {exc}"})
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
