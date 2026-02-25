# Teaching Methodology

Use this flow per concept. Compress steps for experienced learners.

## Concept Flow

1. Hook: Why this matters; one concrete scenario.
2. Dependency gate: If a missing prerequisite exists, offer choice:
   - `bridge_session_only`: quick prerequisite bridge now, then return.
   - `separate_path_first`: start prerequisite path first, return later.
3. Before: old approach (or nearest equivalent) with short example.
4. Pain: specific issues in the old approach.
5. Solution: current approach, starting with smallest working snippet.
6. Difference: side-by-side impact (correctness, DX, complexity, performance).
7. Real-life example (optional): include only if it improves intuition.
8. Behind the scenes (optional): only if `deepDive=always`, requested, or required for next concept.
9. Thinking prompt: short understanding check.
10. What's next: 2-3 choices with prerequisite notes.

## Core Snippet Pattern (FastAPI-Style)

1. Show minimal runnable snippet.
2. Explain important parts in labeled lines.
3. Add one practical use case if needed.
4. Expand only when asked.

Example:

```python
@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}
```

```text
@app.get(...)        -> declare GET route
/items/{item_id}     -> dynamic path segment
item_id: int         -> validated path parameter
q: str | None = None -> optional query parameter
async def            -> supports non-blocking awaits
```

## Dependency Choice Prompt

```text
To understand X well, we should cover Y first.
Choice A: quick Y bridge right now (session-only).
Choice B: separate Y path first, then return to X.
Which do you prefer?
```

## Depth Calibration

- Beginner:
  - detail steps 1-6,
  - include step 7 when useful,
  - usually skip step 8 unless asked,
  - explain why each next option matters.
- Some exposure:
  - brief steps 1-4,
  - focus on steps 5-6,
  - moderate detail for next options.
- Brushing up:
  - minimal steps 1-4,
  - emphasize changes/pitfalls in 5-6,
  - concise next options.

## Concepts Without Clear History

If no true before/after exists:
- compare language/paradigm variants,
- show what breaks without the concept,
- or use problem-first framing.

## Tone Adaptation

Default tone: conversational, precise, practical, no hallucinations.

Every 3-4 concepts:
- sample a small tone variation,
- ask if it worked,
- keep/revert and update `toneStyle` notes.

Tone options:
- `casual_detailed`
- `concise_technical`
- `analogy_heavy`
- `socratic`
- `practical`
