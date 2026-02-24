# Agent Working Rules (V1)

These rules are mandatory for coding tasks in this directory.

## 1) Sequential Thinking Before Coding

Before writing or editing code, run a short sequential-thinking pass that covers:

1. Problem framing and constraints
2. Options considered and chosen approach
3. Edge cases and failure modes
4. Test strategy
5. Final implementation checklist

Use [docs/SEQUENTIAL_THINKING_TEMPLATE.md](/mnt/s/agents-config/test/docs/SEQUENTIAL_THINKING_TEMPLATE.md).

## 2) Clean Code Standard

1. Prefer small, focused functions/modules.
2. Use clear naming.
3. Keep control flow simple and fail fast for invalid states.
4. Avoid unnecessary abstraction and duplication.

## 3) Commenting Standard

1. Add short comments only at non-obvious logic points.
2. Explain why a policy/safety check exists, not line-by-line mechanics.
3. Avoid verbose comments on obvious code.

## 4) Review and Testing Gates

1. PRs must use [.github/pull_request_template.md](/mnt/s/agents-config/test/.github/pull_request_template.md).
2. Reviews must apply [docs/CODE_REVIEW_CHECKLIST.md](/mnt/s/agents-config/test/docs/CODE_REVIEW_CHECKLIST.md).
3. Tests must include edge cases identified in sequential thinking.
4. Test planning should use [docs/TEST_PLAN_TEMPLATE.md](/mnt/s/agents-config/test/docs/TEST_PLAN_TEMPLATE.md).
