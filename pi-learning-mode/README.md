# pi-learning-mode

Teaching-first mode for pi without changing pi core.

This package provides:
- `learning-mode` extension (mode toggle, teaching prompt override, learner profile, book search tool)
- prompt templates (`/learn-session`, `/learn-revise`, `/learn-quiz`, `/learn-bridge`)
- local reference books used by `learn_book_search`

## Install

From this machine:

```bash
pi install /mnt/s/agents-config/pi-learning-mode
```

Or via settings:

```json
{
  "packages": ["/mnt/s/agents-config/pi-learning-mode"]
}
```

Then run:

```bash
/reload
```

## Usage

```bash
/learn
```

CLI start flag:

```bash
pi --learn
```

With topic in one command:

```bash
/learn TypeScript
```

Useful templates:

```bash
/learn-session TypeScript generics
/learn-revise async await
/learn-quiz SQL joins
/learn-bridge operating systems concurrency
```

## Command

- `/learn` to enable mode and start onboarding (if topic is unset)
- `/learn <topic>` to enable mode and immediately start teaching that topic

## Tool

- `learn_book_search(query, book?, maxHits?)`

Use this when the model needs internal teaching references.
