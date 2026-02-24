---
name: frontend-dev-workflow
description: Structured frontend execution workflow with explicit step selection (API discovery/testing, planning, implementation, browser testing, bug resolution) using /wf-frontend and the .agent toolkit.
---

# Frontend Dev Workflow

Use this skill when the user asks for frontend feature work in `my-experimental-development-workflow/frontend` with controlled step execution.

## Activation

Set workflow mode first:

```bash
/wf-frontend 1,2,3
```

Use only selected steps, in numerical order.

## Step Files

- `my-experimental-development-workflow/frontend/.agent/Agent.md`
- `my-experimental-development-workflow/frontend/.agent/steps/1-api-discovery.md`
- `my-experimental-development-workflow/frontend/.agent/steps/2-api-testing.md`
- `my-experimental-development-workflow/frontend/.agent/steps/3-context-and-plan.md`
- `my-experimental-development-workflow/frontend/.agent/steps/4-implementation.md`
- `my-experimental-development-workflow/frontend/.agent/steps/5-testing.md`
- `my-experimental-development-workflow/frontend/.agent/steps/6-bug-resolution.md`

## Required Tooling

Use only the prebuilt toolkit binaries for API work:

- `my-experimental-development-workflow/frontend/.agent/scripts/api`
- `my-experimental-development-workflow/frontend/.agent/scripts/acurl`

Reference:

- `my-experimental-development-workflow/frontend/.agent/docs/API_SCRIPT_USAGE_GUIDE.md`
- `my-experimental-development-workflow/frontend/.agent/docs/PLAN_TEMPLATE.md`

## Enforcement Notes

- Code changes are only valid for implementation/bug-fix flows.
- Step 4 requires a plan file in `my-experimental-development-workflow/frontend/.agent/plans/`.
- Step 5 is browser flow verification only.
