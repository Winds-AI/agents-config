# Agent Workflow

Run **only** steps user lists. Nothing more.

## Ask-Questions Rule

Unclear requirements/API contract (param locations, mutation semantics, permissions/module keys, response shapes) → ask user or write explicit assumption in plan. No silent guessing.

## Steps

1. steps/1-api-discovery.md
2. steps/2-api-testing.md
3. steps/3-context-and-plan.md
4. steps/4-implementation.md
5. steps/5-testing.md
6. steps/6-bug-resolution.md

## Rules

1. Match numbers → run those steps only.
2. Multiple steps → numerical order.
3. Read step file before need and executing only.

## Combinations

- **3 + 4**: Skip plan approval. Default answers to decisions.
- **3 + 5** (or 5 included): Add `## Test Cases` to plan.
- **4 alone**: Requires `.agent/plans/PLAN_<feature>.md`. Missing → ask user.
- **5 alone**: Derive test cases from feature user flows.

## Resources

| Resource               | Path                                    |
| ---------------------- | --------------------------------------- |
| API toolkit usage      | `.agent/docs/API_SCRIPT_USAGE_GUIDE.md` |
| Plan template          | `.agent/docs/PLAN_TEMPLATE.md`          |
| Browser automation     | `agent-browser` skill                   |

## API Toolkit Context

- Use prebuilt binaries directly:
  - `./.agent/scripts/api` for OpenAPI discovery.
  - `./.agent/scripts/acurl` for guarded API execution.
- Do not change toolkit/config unless user explicitly asks.
