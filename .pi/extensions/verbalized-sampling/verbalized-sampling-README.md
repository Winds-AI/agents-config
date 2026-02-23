# Verbalized Sampling Extension

Based on Stanford's "Verbalized Sampling" research: instead of the model collapsing to one answer,
ask it to generate N diverse approaches with probability/confidence estimates, then pick the best one.

## Usage

```
/approaches [n] <topic>
```

| Example | Effect |
|---------|--------|
| `/approaches 4 db schema` | propose 4 approaches for "db schema" |
| `/approaches auth strategy` | propose 3 approaches (default N) |
| `/approaches 2 caching layer` | propose 2 approaches |

N is clamped to 2–5.

## Flow

1. You run `/approaches 4 db schema`
2. A message is sent to the agent with verbalized sampling instructions
3. Agent generates 4 approaches with confidence % each
4. `present_approaches` opens a TUI:
   - Left panel: approach list with colored confidence bars
   - Right panel: markdown details (summary, pros, cons, implementation notes)
5. Navigate with `↑↓` or press `1–N` to quick-pick, `Enter` to select, `Esc` to cancel
6. Agent proceeds with the chosen approach

## Caching design

Tool definitions live in the system prompt prefix — the part Claude caches across turns.
`setActiveTools()` changes that prefix and busts the cache on every call.

This extension never calls `setActiveTools()`. The `present_approaches` tool is always
registered (stable prefix = always cached). The one-shot message sent by `/approaches`
lands at the tail of the conversation context, which is never cached anyway — so
there is no caching cost to using this command repeatedly.
