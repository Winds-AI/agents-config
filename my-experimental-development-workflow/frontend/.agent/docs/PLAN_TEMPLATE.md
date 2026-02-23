# Plan Template

## 1. Overview

```
## Overview
- APIs: GET /users/:id — fetch profile (new), PUT /users/:id — update profile (new)
- Files: 3 new, 2 modified, 1 deleted
- Out of scope: [items]
```

## 2. API Validation Report

```
## API Validation Report
✓ GET /users/:id — 200, returns { id, name, email, phone, avatar }
⚠ Avatar field sometimes null
? Is null avatar backend bug or expected?
```

## 3. Open Questions

Integration-critical questions only (change code shape or break backend contract).

```
## Open Questions
1. Permissions/roles: module key (exact string) + level per screen/action?
2. Mutations: request shape (path/query/body), required fields, partial update clears vs ignores omitted fields?
3. Data shape: list/search/detail response differences; UI normalization target?
```

## 4. Decisions

Genuinely ambiguous ones only.

```
## Decisions
[DECISION 1] Component location?
  A: src/modules/users/UserProfile.tsx
  B: src/components/User/Profile.tsx
  → Question: which fits your architecture?
```

## 5. Implementation Plan

Tag file headers: `(NEW)`, `(MODIFIED)`, `(DELETE)`. File manifest.

```
## Implementation Plan

### src/types/User.ts (NEW)
1. UserProfile interface from API response
2. UserProfileUpdate interface for form

### src/pages/Settings.tsx (MODIFIED)
1. Import UserProfile
2. Add to layout

### src/components/OldUserProfile.js (DELETE)
```

## 6. Blockers/Assumptions

```
## Blockers/Assumptions
- Assuming Bearer token configured
- Need clarification: avatar upload in scope?
- Risk: API latency on initial load
```

---

## Optional: Phases

Include when >8 files or multiple sub-domains. Each phase compiles independently.

```
## Phases

| Phase | Scope | Files | Verification |
|-------|-------|-------|--------------|
| 1 | API layer + routes + page shells | [list] | Pages render, no data |
| 2 | Primary CRUD flows | [list] | List/create/edit works |
| 3 | Secondary features + polish | [list] | Full feature complete |
```

---

## Optional: Test Cases

Include only when Step 5 in current task.

```
## Test Cases
- Load page (data renders)
- Create/update flow (success + error)
- Empty state
```
