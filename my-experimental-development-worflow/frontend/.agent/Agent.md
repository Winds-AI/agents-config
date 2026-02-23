# Agent Workflow

Run **only** steps user lists. Nothing more.

## Ask-Questions Rule

Unclear requirements/API contract (param locations, mutation semantics, permissions/module keys, response shapes) → ask user or write explicit assumption in plan. No silent guessing.

## Steps

| #   | Keywords                              | File                          |
| --- | ------------------------------------- | ----------------------------- |
| 1   | `api discovery`, `1`                  | `steps/1-api-discovery.md`    |
| 2   | `api testing`, `2`                    | `steps/2-api-testing.md`      |
| 3   | `context`, `plan`, `3`                | `steps/3-context-and-plan.md` |
| 4   | `implementation`, `implement`, `4`    | `steps/4-implementation.md`   |
| 5   | `testing`, `test`, `5`                | `steps/5-testing.md`          |
| 6   | `bug`, `issue`, `fix`, `resolve`, `6` | `steps/6-bug-resolution.md`   |

## Rules

1. Match keywords/numbers → run those steps only.
2. Multiple steps → numerical order.
3. Read step file before executing.
4. Respect step boundaries — no bleeding.
5. Feature/module name follows step refs (e.g., `"1","2" - certificate management`).
6. Tool calls sequential by default; parallelize only if user asks.

## Combinations

- **3 + 4**: Skip plan approval. Default answers to decisions.
- **3 + 5** (or 5 included): Add `## Test Cases` to plan.
- **4 alone**: Requires `.agent/plans/PLAN_<feature>.md`. Missing → ask user.
- **5 alone**: Derive test cases from feature user flows.

## Resources

| Resource               | Path                                    |
| ---------------------- | --------------------------------------- |
| API env + curl wrapper | `.agent/scripts/api-env.sh`             |
| API token usage        | `.agent/docs/API_SCRIPT_USAGE_GUIDE.md` |
| Plan template          | `.agent/docs/PLAN_TEMPLATE.md`          |
| Browser automation     | `.agent/skills/agent-browser/`          |
| Project patterns       | `docs/PROJECT_PATTERNS.md`              |
| Project structure      | `AGENTS.md`                             |
