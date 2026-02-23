# Step 3: Context Gathering & Plan

## Procedure

### Gather Context

1. Read project patterns + structure files (Resources in `Agent.md`).
2. Find closest existing module to feature. Read pages, API layer, components as reference.
   - Reference module may have workarounds/mappings; confirm match current feature's API contract.
3. Check route config, navigation config, permission definitions (paths per project patterns).
4. Step 1/2 output exists → incorporate. Otherwise mark API validation pending.
5. Before finalizing plan: list integration-critical open questions (permissions/module key, param locations, mutation semantics, response shape differences). Unanswered → mark explicit assumptions.

### Write Plan

6. Use template `.agent/docs/PLAN_TEMPLATE.md`. Required sections:
   - Overview
   - API Validation Report
   - Open Questions (answered or accepted as assumptions)
   - Decisions (ambiguous + important flow-deciding ones)
   - Implementation Plan
   - Blockers/Assumptions
7. Add `## Phases` when >8 files or multiple sub-domains (see template).
8. Add `## Test Cases` only if Step 5 in current task.
9. Save `.agent/plans/PLAN_<feature>.md`.
10. Wait user approval — unless Step 4 also in current task.

## Boundaries

- No code.
- No browser tests.
