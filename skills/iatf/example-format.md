# IATF Example Format

## Authoring Template (Start Here)

```iatf
:::IATF
@title: Document Title
@purpose: Optional purpose

===CONTENT===

{#section-id}
@summary: Brief summary shown in INDEX
# Section Title
Content goes here. Link other sections with {@other-id}.
{/section-id}
```

## Rebuilt File Shape (After `iatf rebuild`)

```iatf
:::IATF
@title: Document Title
@purpose: Optional purpose

===INDEX===
<!-- AUTO-GENERATED - DO NOT EDIT MANUALLY -->
<!-- Generated: 2026-02-17T12:34:56Z -->
<!-- Content-Hash: sha256:abc1234 -->

# Section Title {#section-id | lines:20-27 | words:18}
> Brief summary shown in INDEX
  Created: 2026-02-17 | Modified: 2026-02-17
  Hash: 1a2b3c4

===CONTENT===

{#section-id}
@summary: Brief summary shown in INDEX
# Section Title
Content goes here. Link other sections with {@other-id}.
{/section-id}
```

## Rules (Current Implementation)

- Edit `CONTENT` only. `INDEX` is generated.
- Run `iatf rebuild <file>` after edits, then `iatf validate <file>`.
- Section IDs must match `{#id}...{/id}` and be unique.
- Max nesting depth is 2 levels.
- References in fenced code blocks are ignored by reference validation/graph extraction.
- Section title in INDEX is taken from the first markdown heading inside a section; if none exists, the ID is used.
