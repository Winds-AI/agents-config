# KittenTTS Extension

This extension speaks assistant text responses from Pi.
- It speaks `assistant` text blocks only.
- It does not read tool call logs.
- Audio is planned semantically (headings, labels, bullets, code, commands) with pauses at logical breaks.

The worker is CPU-only and runs Kitten ONNX models directly with `onnxruntime` (no `torch` required).

## Config (top of file)

Edit `.pi/extensions/kittentts/index.ts`:

```ts
const PYTHON_BIN = ".pi/extensions/kittentts/.venv/bin/python";
const MODEL_REPO_ID = "KittenML/kitten-tts-micro-0.8";
const PLAYER_PRIORITY = ["pw-play", "paplay", "aplay"];
const HF_HOME = ".pi/extensions/kittentts/.hf-home";
const DEFAULT_VOICE = "Jasper";
const SPEECH_PLANNER_ENABLED = true;
const CODE_SPEECH_POLICY = "summarize"; // summarize | short | verbatim
const PAUSE_PROFILE = "balanced"; // fast | balanced | expressive
```

All runtime knobs are at the top of `index.ts`.

Speech-planning logic:
- `.pi/extensions/kittentts/speech-planner.ts`

Worker logic:
- `.pi/extensions/kittentts/kittentts_worker.py`

## Install (CPU-only, no GPU/torch)

```bash
sudo apt update
sudo apt install -y python3-venv python3-full pipewire-bin pulseaudio-utils alsa-utils

python3 -m venv .pi/extensions/kittentts/.venv
source .pi/extensions/kittentts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r .pi/extensions/kittentts/requirements-cpu.txt
deactivate
```

If this venv previously used `kittentts` + `torch`, remove heavy packages:

```bash
source .pi/extensions/kittentts/.venv/bin/activate
python -m pip uninstall -y kittentts torch torchvision torchaudio spacy spacy-curated-transformers
deactivate
```

Then reload Pi (`/reload`) or restart it.

## Enable Extension

Ensure `.pi/settings.json` includes:

```json
{
  "extensions": [
    "./.pi/extensions/kittentts/index.ts"
  ]
}
```

## Models

Supported 0.8 repos:
- `KittenML/kitten-tts-mini-0.8`
- `KittenML/kitten-tts-micro-0.8`
- `KittenML/kitten-tts-nano-0.8-fp32`
- `KittenML/kitten-tts-nano-0.8-int8`

These ONNX models are downloaded into:
- `.pi/extensions/kittentts/.hf-home/hub/models--KittenML--...`

List cached models:

```bash
ls -1 .pi/extensions/kittentts/.hf-home/hub | rg '^models--KittenML--kitten-tts-'
```

Delete a cached model:

```bash
rm -rf .pi/extensions/kittentts/.hf-home/hub/models--KittenML--kitten-tts-mini-0.8
```

## Voices

Alias voices used by this extension:
- `Bella`, `Jasper`, `Luna`, `Bruno`, `Rosie`, `Hugo`, `Kiki`, `Leo`

Set at runtime:

```text
/tts voice Jasper
```

## Commands

- `/tts` toggles on/off
- `/tts on` enables
- `/tts off` disables and clears queue
- `/tts voice <name>` sets voice

## Quick Checks

Dependency check:

```bash
.pi/extensions/kittentts/.venv/bin/python -c "import espeakng_loader, numpy, onnxruntime, soundfile, huggingface_hub, phonemizer; print('ok')"
```

Worker check:

```bash
printf '{"op":"shutdown"}\n' | HF_HOME=.pi/extensions/kittentts/.hf-home .pi/extensions/kittentts/.venv/bin/python .pi/extensions/kittentts/kittentts_worker.py --model KittenML/kitten-tts-micro-0.8 --players pw-play,paplay,aplay
```

If first run is slow, that is usually initial model download/caching.
If you see HF rate-limit warnings, set `HF_TOKEN` in your shell environment.

## Performance Tuning (CPU)

Set ONNX Runtime threading in your shell before starting Pi:

```bash
export KITTENTTS_ORT_INTRA_THREADS=4
export KITTENTTS_ORT_INTER_THREADS=1
```

For slower CPUs, `KittenML/kitten-tts-nano-0.8-int8` is usually faster than `micro`.

## Temp Audio Files

The worker writes each chunk to a temporary WAV file:
- `/tmp/pi-kittentts-*.wav`

After playback, the worker deletes that file automatically.
If Pi or the worker is force-killed, a few temp files may remain in `/tmp`.
