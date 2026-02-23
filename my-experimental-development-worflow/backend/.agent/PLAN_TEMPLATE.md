# Plan Template (Backend)

---

## 1. Overview

```markdown
## Overview
- Feature: Brief description
- Module: admin | vendor | customer
- Endpoints:
  - POST /bandar-admin/resources — Create (new)
  - GET /bandar-admin/resources/{id} — Get by ID (new)
- Files: 2 new, 3 modified, 1 migration
- Out of scope: What won't be included
```

## 2. Schema Analysis

```markdown
## Schema Analysis

| Table | Key Fields | Relationship |
|-------|------------|--------------|
| Activities | id, vendorId, status | belongsTo Vendor |
| Vendors | id, businessName | hasMany Activities |

Data patterns: ~500 activities, 80% active, queried by vendorId + status
```

## 3. Migration Plan (if needed)

```markdown
## Migration Plan

- NEW TABLE: ResourceLogs (id, resourceId FK, action ENUM, timestamps)
- ALTER: Resources ADD lastLogId, ADD INDEX idx_status
- Rollback: DROP TABLE, DROP COLUMN
```

## 4. Design Decisions (only if ambiguous)

```markdown
## Design Decisions

[DECISION] Soft delete or hard delete?
  A: Soft delete with deletedAt
  B: Hard delete with audit log
  → Question: Which preferred?
```

## 5. Implementation Plan

```markdown
## Implementation Plan

### Migration: YYYYMMDDHHMMSS-add-resource-logs.js (NEW)
- Create table, add FK + index, down reverses

### Model: src/models/resourceLogs.js (NEW)
- Define model with associations

### Function: src/functions/admin/resource.function.js (NEW)
- POST: validate → create in transaction → return
- GET /{id}: validate → query with includes → return or 404

### Swagger: src/swagger/routes/admin/resources.js (NEW)
- Define schemas, document endpoints
```

## 6. Blockers/Assumptions

```markdown
## Blockers/Assumptions
- Assumes JWT middleware handles auth
- Blocker: Need clarification on X (if any)
```

---

# Example Plan

```markdown
# Backend Plan: Activity Status History

## Overview
- Feature: Track activity status changes with timestamps and actor
- Module: admin
- Endpoints:
  - GET /bandar-admin/activities/{id}/history (new)
- Files: 1 model, 1 function, 1 migration, 2 modified
- Out of scope: Bulk export, customer-facing history

## Schema Analysis

| Table | Key Fields |
|-------|------------|
| Activities | id, status, vendorId |
| Admin | id, firstName, lastName |

Data: ~500 activities, status changes ~2x per lifecycle

## Migration Plan

- NEW TABLE: ActivityStatusHistory
  - id (UUID PK), activityId (FK), previousStatus, newStatus, changedBy (FK Admin), changedAt
  - INDEX: idx_history_activity_id
- Rollback: DROP TABLE

## Design Decisions

[DECISION] Store full status or just changes?
  → Recommendation: Store previous + new for easy diffing

## Implementation Plan

### Migration: 20250205-create-activity-status-history.js (NEW)
- Create table with FKs and index

### Model: src/models/activityStatusHistory.js (NEW)
- Define model, associate with Activity and Admin

### Function: src/functions/admin/activityHistory.function.js (NEW)
- GET handler: query history DESC, include admin details

### Modified: src/functions/admin/adminActivityManagement.function.js
- After status update, create history record in transaction

## Blockers/Assumptions
- Assumes Admin model has proper associations
- System changes will have null changedBy
```
