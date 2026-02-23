---
name: iatf
description: Work with .iatf files using index-first retrieval. Use for create/edit/validate/query of IATF docs.
---

# IATF

IATF is a self-indexing format:
- `INDEX` = navigation cache
- `CONTENT` = source of truth

## Mandatory Flow

Use this flow for every `.iatf` task unless user explicitly asks otherwise.

1. Discover, don't scan
- `iatf index <file>` to see section IDs/summaries
- `iatf find <file> <query>` to rank relevant IDs

2. Read only what is needed
- `iatf read <file> <id>` for single-section lookup
- `iatf read-many <file> <id> [id...]` for multi-section lookup in one call
- For dependency/impact questions, use:
  - `iatf graph <file>`
  - `iatf graph <file> --show-incoming`

3. Expand one hop when needed
- If a read section references `{@id}`, read those IDs next.

4. Edit safely
- Edit `CONTENT` only
- Never edit `INDEX` manually
- After edits: `iatf rebuild <file>` then `iatf validate <file>`

5. If validation fails
- Fix structural/reference errors first
- Rebuild + validate again

## Hard Rules

- Prefer `iatf` commands over full-file `cat`/global grep for `.iatf` retrieval.
- Do not assume references inside fenced code blocks are real edges.
- Keep answers grounded in retrieved section IDs and summaries.

## Core Commands

```bash
iatf index <file>
iatf find <file> <query>
iatf read <file> <id>
iatf read-many <file> <id> [id...]
iatf graph <file>
iatf graph <file> --show-incoming
iatf rebuild <file>
iatf validate <file>
```
See `additional-commands.md` in this same skill directory for watch/daemon and utility commands.

## Fast Patterns

```bash
# Ranked retrieval (top 3), one call to read-many
iatf read-many doc.iatf $(iatf find doc.iatf "<query>" | cut -f1 | head -3)

# Incoming impact for a section ID
iatf graph doc.iatf --show-incoming | rg '^section-id'
```
