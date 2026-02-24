# Engineering Process Rules (V1)

This repository follows a mandatory process layer for all implementation work.

## Required Before Coding

Complete a short sequential-thinking pass before editing files:

1. Problem framing and constraints
2. Options considered and chosen approach
3. Edge cases and failure modes
4. Test strategy
5. Final implementation checklist

Use [docs/SEQUENTIAL_THINKING_TEMPLATE.md](/mnt/s/agents-config/test/docs/SEQUENTIAL_THINKING_TEMPLATE.md) for this pass.

Notes:
- The pass is required for each coding task.
- Notes can remain ephemeral unless persistence is requested.

## Code Quality Rules

1. Prefer small, focused functions/modules.
2. Use clear names over clever abstractions.
3. Keep branching simple and fail fast on invalid states.
4. Reduce duplication with small helpers when useful.

## Commenting Standard

1. Add short comments only where intent is non-obvious.
2. Comments should explain why (policy/safety reason), not line-by-line mechanics.
3. Avoid noisy comments for obvious code.

## Review and Merge Gates

Pre-merge and review checklists are required:
- [docs/CODE_REVIEW_CHECKLIST.md](/mnt/s/agents-config/test/docs/CODE_REVIEW_CHECKLIST.md)
- [.github/pull_request_template.md](/mnt/s/agents-config/test/.github/pull_request_template.md)

## Test Planning Requirement

Tests must include edge conditions identified in the sequential-thinking pass.
Use [docs/TEST_PLAN_TEMPLATE.md](/mnt/s/agents-config/test/docs/TEST_PLAN_TEMPLATE.md) when defining test scope.
