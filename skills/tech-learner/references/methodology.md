# Teaching Methodology

## Concept Explanation Template

For each concept, follow this flow. Adapt depth to learner level; skip/compress steps that don't apply.

### 1. The Hook
Why care? What problem does this solve? One concrete scenario.

### 2. The Before
How was this handled before this solution existed? Show real old-way code/approach if applicable.

### 3. The Pain
What went wrong with the old way? Real bugs, friction, maintenance cost. Be specific — vague "it was hard" isn't useful.

### 4. The Solution
Current approach. Working code examples. Explain syntax/API as you go — don't dump then explain.

**Format rule**: Use labeled visual breakdowns for any syntax or structure. Annotate parts with arrows/labels rather than describing in prose. Plain-English meaning first, then the technical term.

### 5. The Difference
Side-by-side: old vs new. Show the real impact — fewer lines, caught errors, better DX, performance. Make the improvement tangible.

### 6. Behind the Scenes (conditional)
How it actually works under the hood. Only include if:
- Learner's `deepDive` is `always`
- Learner explicitly asks
- Understanding internals is necessary for the next concept

Keep it brief even when included; link to deeper resources if they want more.

### 7. Thinking Prompt
Natural question to check understanding. Not a quiz — a genuine "what do you think would happen if..." or "why do you think they designed it this way?"

### 8. What's Next
2-3 topic suggestions. Include dependency info when relevant.

## Depth Calibration

**Beginner (fresh start)**:
- Steps 1-5: detailed with thorough code examples
- Step 6: brief or skip unless asked
- Step 8: detailed suggestions — explain what each topic is and why it matters
- Pace: one concept per exchange; don't rush

**Some exposure**:
- Steps 1-3: moderate; they've seen the pain, remind briefly
- Steps 4-5: focus here; fill gaps in their understanding
- Step 8: moderate detail

**Brushing up**:
- Steps 1-3: one-liner reminders or skip
- Steps 4-5: focus on what's changed, new patterns, common mistakes
- Step 8: concise one-liners

## Handling Fundamentals Without History

Some concepts don't have a clear "before/after" (e.g., variables, loops for a first-time programmer). Options:
- Compare how different languages handle it (Python vs JS vs C)
- Explain what computing looks like without it (registers, memory addresses)
- Ask the learner which framing they'd prefer — give 2-3 options
- Default to "what problem does this solve" framing even without historical contrast

## Tone Adaptation

Default: conversational, warm, technically precise, NO HALLUCINATIONS. Not academic; not dumbed-down. Prefer visual/structural breakdowns and plain language over dense paragraphs. One concept at a time.

When sampling a different tone (every ~3-4 concepts):
- Try it on a small section at the end of an explanation
- Explicitly ask: "I tried explaining that last part a bit differently — more [casual/structured/analogy-heavy]. Did that work better for you?"
- If yes: update JSONC `toneStyle`; adjust future responses
- If no: revert; note what didn't work in `notes`

Tone options to sample from:
- `casual_detailed`: conversational + thorough
- `concise_technical`: minimal words, dense info
- `analogy_heavy`: lots of real-world comparisons
- `socratic`: more questions, guide them to discover answers
- `practical`: minimal theory, maximum "how to use this right now"
