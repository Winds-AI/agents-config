# KittenTTS Extension

This extension speaks assistant text responses from Pi.
- It speaks `assistant` text blocks only.
- It does not read tool call logs.
- Audio is planned semantically (headings, labels, bullets, code, commands) with pauses at logical breaks.

## Config (top of file)

Edit `.pi/extensions/kittentts/index.ts`:

```ts
const PYTHON_BIN = ".pi/extensions/kittentts/.venv/bin/python";
const MODEL_REPO_ID = "KittenML/kitten-tts-mini-0.8";
const PLAYER_PRIORITY = ["pw-play", "paplay", "aplay"];
const HF_HOME = ".pi/extensions/kittentts/.hf-home";
const DEFAULT_VOICE = "Bella";
const SPEECH_PLANNER_ENABLED = true;
const CODE_SPEECH_POLICY = "summarize"; // summarize | short | verbatim
const PAUSE_PROFILE = "balanced"; // fast | balanced | expressive
```

All main runtime knobs are at the top of `index.ts`.

Speech-planning logic is in:
- `.pi/extensions/kittentts/speech-planner.ts`

Worker protocol logic is in:
- `.pi/extensions/kittentts/kittentts_worker.py`

## Install (Ubuntu, PEP 668 safe)

```bash
sudo apt update
sudo apt install -y python3-venv python3-full pipewire-bin pulseaudio-utils alsa-utils

python3 -m venv .pi/extensions/kittentts/.venv
source .pi/extensions/kittentts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install https://github.com/KittenML/KittenTTS/releases/download/0.8/kittentts-0.8.0-py3-none-any.whl
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

These are ONNX models downloaded by KittenTTS into:
- `.pi/extensions/kittentts/.hf-home/hub/models--KittenML--...`

List cached Kitten models:

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
.pi/extensions/kittentts/.venv/bin/python -c "import kittentts; print('ok')"
```

Worker check:

```bash
printf '{"op":"shutdown"}\n' | HF_HOME=.pi/extensions/kittentts/.hf-home .pi/extensions/kittentts/.venv/bin/python .pi/extensions/kittentts/kittentts_worker.py --model KittenML/kitten-tts-mini-0.8 --players pw-play,paplay,aplay
```

If first run is slow, that is usually initial model download/caching.
If you see HF rate-limit warnings, set `HF_TOKEN` in your shell environment.

## Temp Audio Files

The worker writes each chunk to a temporary WAV file:
- `/tmp/pi-kittentts-*.wav`

After playback, the worker deletes that file automatically.
If Pi or the worker is force-killed, a few temp files may remain in `/tmp`.
