---
name: backend-api-workflow
description: Backend API-only workflow for discovery and guarded API execution in my-experimental-development-workflow/backend using .agent/scripts/api and .agent/scripts/acurl.
---

# Backend API Workflow

Use this skill for backend API tasks in `my-experimental-development-workflow/backend`.

## Activation

```bash
/wf-backend
```

## Source of Truth

- `my-experimental-development-workflow/backend/.agent/Agent.md`
- `my-experimental-development-workflow/backend/.agent/docs/API_SCRIPT_USAGE_GUIDE.md`

## Allowed Operations

- OpenAPI discovery with `my-experimental-development-workflow/backend/.agent/scripts/api`
- Guarded API calls with `my-experimental-development-workflow/backend/.agent/scripts/acurl`

## Constraints

- API-only workflow; no file implementation work.
- If API contract is unclear, ask instead of assuming.
