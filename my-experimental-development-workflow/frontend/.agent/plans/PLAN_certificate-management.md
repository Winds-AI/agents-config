## Overview
- Goal: Implement Certificate Management in Bandar Admin Frontend, mirroring the existing Badge Management module structure.
- Submodules:
  - Certificate Management: list/create/edit/toggle/delete certificates.
  - Certificate Assignment: assign certificates to customers/activities + view assigned certificates by customer/activity (same UX pattern as Badge Assignment).
- APIs (validated in Step 2):
  - Certificates CRUD:
    - GET `/bandar-admin/certificates`
    - POST `/bandar-admin/certificates`
    - GET `/bandar-admin/certificates/{id}`
    - PATCH `/bandar-admin/certificates/{id}`
    - PATCH `/bandar-admin/certificates/{id}/status`
    - DELETE `/bandar-admin/certificates/{id}` (not callable in `API_MODE=safe-updates`, but should be implemented in UI)
  - Assignment:
    - POST `/bandar-admin/certificates/{id}/assign-activity`
    - POST `/bandar-admin/certificates/{id}/assign-user`
    - POST `/bandar-admin/badges-certificates/find-by-activities`
    - POST `/bandar-admin/badges-certificates/find-by-customers`
    - POST `/bandar-admin/activities/{activityId}/certificates/bulk` (optional)
    - POST `/bandar-admin/customers/{customerId}/activities/{activityId}/certificates/bulk` (optional)
    - DELETE `/bandar-admin/activities/{activityId}/certificates` (unassign all, blocked in safe-updates)
    - DELETE `/bandar-admin/customers/{customerId}/certificates` (unassign all, blocked in safe-updates)
- Files (expected):
  - New: `src/api/certificate-management/*`, `src/pages/certificate-management/*`, `src/sections/certificate-management/*`
  - Modified: `src/api/routes.ts`, `src/routes/paths.ts`, `src/routes/sections/modules.tsx`, `src/layouts/dashboard/config-navigation.tsx`, `src/constants/permission-modules.ts` (depending on decision)
- Out of scope (unless you want it):
  - Certificate rendering/generation logic (this UI is admin CRUD + assignment only).

## API Validation Report
Validated against `active_env=dev` (`API_BASE=https://bandar-app-dev.azurewebsites.net/api`) on 2026-02-10.

✓ GET `/bandar-admin/certificates?page=1&limit=5` — 200
- Returns: `{ success, status, message, data: { count, rows: Certificate[] } }`
- Observed `Certificate` fields include OpenAPI fields plus additional nested audit objects:
  - Extra: `createdByAdmin`, `updatedByAdmin` (objects with `{id, firstName, lastName, email}`)

✓ GET `/bandar-admin/certificates/{id}` — 200
- Returns: `{ data: CertificateDetail }`
- Observed extra fields not shown in Step 1 summary:
  - `createdBy`, `updatedBy`, `deletedAt`
  - `certificateActivities[]` with nested `activity` objects (`{ id, adventureName, displayId }`)

✓ POST `/bandar-admin/certificates` — 201
- Payload tested:
  - `{ title, description, criteriaType, templateUrl }`
- Response includes:
  - `id`, `isActive`, `deletedAt`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`
- Created test record:
  - `id=b19ce1ee-aab6-4751-ba7b-74928032a04b`, `title=[agent-test] Certificate API`

✓ PATCH `/bandar-admin/certificates/{id}` — 200
- Response returns updated `data` object (not just message)

✓ PATCH `/bandar-admin/certificates/{id}/status` — 200
- Payload: `{ isActive: boolean }`
- Response returns updated `data` object

⚠ GET `/bandar-admin/certificates-search?search=...&limit=...` — 200 but response shape differs from Step 1 OpenAPI summary
- Observed response:
  - `{ data: { count, rows: [] } }`
- Step 1 OpenAPI summary suggested:
  - `{ data: { count, certificates: [] } }`
- Plan: implement UI/autocomplete to handle both `data.rows` and `data.certificates` defensively.

✓ POST `/bandar-admin/badges-certificates/find-by-activities` — 200
- Observed response:
  - `{ data: { rows: { badges: [], certificates: CertificateAssignment[] }, count: { badges, certificates } } }`
- `certificates[]` items include nested `certificate` object (title/description/templateUrl/isActive) and nested `activity` object.

✓ POST `/bandar-admin/badges-certificates/find-by-customers` — 200 (tested with non-existing customerId, returned empty)

✓ POST `/bandar-admin/activities/{activityId}/certificates/bulk` — 404 for invalid activity (no mutation)
✓ POST `/bandar-admin/customers/{customerId}/activities/{activityId}/certificates/bulk` — 404 for invalid customer (no mutation)

## Decisions
[DECISION 1] Permissions module key for Certificates
- A: Reuse `PERMISSION_MODULES.BADGE_MANAGEMENT` for certificates (fast, but couples access control).
- B: Add `PERMISSION_MODULES.CERTIFICATE_MANAGEMENT = 'Certificates'` (clean separation, but must match backend module naming).
- Pending: confirm the backend permission module name used in roles for certificates.

[DECISION 2] Assignment APIs to use in UI
- A (Recommended): Use `/bandar-admin/certificates/{id}/assign-user` and `/assign-activity` for assignment actions (mirrors badges UX).
- B: Use bulk endpoints under `.../certificates/bulk` (requires extra customer+activity context; different from badges).
- Plan assumes A for the "Assign Certificate" tab, and uses `find-by-*` endpoints for lookup tabs.

[DECISION 3] Template file type + upload UX
- A (Recommended): Use `UploadSingleFile` and allow PDF + images; preview using same PDF/image logic as badge assignment.
- B: Restrict to PDF only.

## Implementation Plan

### src/api/routes.ts (MODIFIED)
1. Add `API_ROUTES.CERTIFICATE_MANAGEMENT` constants:
   - `LIST`, `DETAIL(id)`, `CREATE`, `UPDATE(id)`, `DELETE(id)`, `TOGGLE_STATUS(id)`, `SEARCH`
   - `ASSIGN_USER(id)`, `ASSIGN_ACTIVITY(id)`
   - Reuse existing shared endpoints (either duplicate keys under CERTIFICATE_MANAGEMENT or keep under BADGE_MANAGEMENT):
     - `/bandar-admin/badges-certificates/find-by-customers`
     - `/bandar-admin/badges-certificates/find-by-activities`
   - Add unassign-all endpoints for certificates:
     - `/bandar-admin/customers/{customerId}/certificates`
     - `/bandar-admin/activities/{activityId}/certificates`

### src/api/certificate-management/types.ts (NEW)
1. `CertificateCriteriaType` (likely reuse `BadgeCriteriaType` values: `single_activity | multiple_activities`)
2. `CertificateItem`, `CertificateDetailItem`
3. List/search/filter params:
   - `CertificateFilterParams { page, limit, search?, isActive? }`
4. CRUD responses:
   - `GetCertificatesResponse`, `GetCertificateDetailResponse`, `CreateCertificateResponse`, `UpdateCertificateResponse`, `DeleteCertificateResponse`, `ToggleCertificateStatusResponse`
5. Assignment types:
   - `AssignCertificateToUsersPayload { userIds: string[] }`
   - `AssignCertificateToActivitiesPayload { activityIds: string[] }`
   - `CertificateAssignmentItem` mirroring badge assignment patterns, but using `certificateId`, nested `certificate`, etc.
   - Lookup response types for `find-by-*` that include `{ rows: { certificates }, count: { certificates }, totalCertificates? }`

### src/api/certificate-management/api.ts (NEW)
1. CRUD functions using `AuthClient` and `API_ROUTES.CERTIFICATE_MANAGEMENT.*`
2. Normalize data defensively:
   - Ensure UI has `title`/`name` as needed (prefer `title` for certificates)
   - Search endpoint: support both `data.rows` and `data.certificates`
3. Assignment functions:
   - `assignCertificateToUsers(id, payload)`
   - `assignCertificateToActivities(id, payload)`
   - `findCertificatesByCustomers({ customerIds })` via shared `find-by-customers` endpoint; extract `certificates`
   - `findCertificatesByActivities({ activityIds })` via shared `find-by-activities` endpoint; extract `certificates`
   - `unassignCertificatesFromCustomer({ customerId, certificateId? })` (assume optional query param similar to badges; if backend differs, adjust after Step 4 testing)
   - `unassignCertificatesFromActivity({ activityId, certificateId? })`
4. React Query hooks mirroring `src/api/badge-management/api.ts`:
   - list/detail queries
   - assign/unassign mutations + invalidation keys for lookup tabs

### src/api/certificate-management/index.ts (NEW)
1. Barrel export `api.ts` hooks and types (match `src/api/badge-management/index.ts` style).

### src/pages/certificate-management/CertificateListPage.tsx (NEW)
1. Same pattern as `src/pages/badge-management/BadgeListPage.tsx`:
   - set page title/subtitle
   - render `CertificateListView`

### src/pages/certificate-management/CertificateEditPage.tsx (NEW)
1. Same pattern as `src/pages/badge-management/BadgeEditPage.tsx`
2. Render `CertificateEditForm`

### src/pages/certificate-management/CertificateAssignmentPage.tsx (NEW)
1. Same pattern as `src/pages/badge-management/BadgeAssignmentPage.tsx`
2. Render `CertificateAssignment`

### src/sections/certificate-management/certificate-list-view.tsx (NEW)
1. Mirror `src/sections/badge-management/badge-list-view.tsx`
2. Columns:
   - Certificate (title + maybe template indicator)
   - Active Status (toggle)
   - Updated At
   - Actions (edit/delete)
3. Search + filter tabs using `isActive` mapping
4. Permission checks: align with Decision 1

### src/sections/certificate-management/components/certificate-table-row.tsx (NEW)
1. Mirror `src/sections/badge-management/components/badge-table-row.tsx`
2. Add a quick preview action if templateUrl exists (image/pdf detection), optional.

### src/sections/certificate-management/certificate-edit-form.tsx (NEW)
1. Mirror `src/sections/badge-management/badge-edit-form.tsx`
2. Form fields:
   - `title` (required)
   - `criteriaType` (single/multiple)
   - `isActive` switch
   - `description` (optional)
   - `templateUrl` via `UploadSingleFile` (Decision 3)
3. Create vs edit using `id === 'new'`
4. Use `CommonButtonsFooter` for edit/delete/cancel permissions

### src/sections/certificate-management/components/certificate-assignment.tsx (NEW)
1. Copy the UX structure from `src/sections/badge-management/components/badge-assignment.tsx`:
   - Primary tabs:
     - Assign Certificate
     - Customer Certificates (lookup)
     - Activity Certificates (lookup)
   - Inner tabs for assignment:
     - Assign to Activity/Activities
     - Assign to Customer/Customers
2. Replace:
   - Badge APIs with Certificate APIs
   - Badge search endpoint with certificate list/search endpoint
   - preview rendering to use `templateUrl` (PDF/image)
3. Lookup tabs:
   - Use `find-by-customers`/`find-by-activities` endpoints and render assigned certificates list
4. Unassign:
   - Implement unassign buttons if backend supports `certificateId` query param; otherwise provide "Unassign all" only when `API_MODE=full-access` in dev (to avoid accidental destructive ops).

### src/routes/paths.ts (MODIFIED)
1. Add `paths.certificateManagement` mirroring `paths.badgeManagement`:
   - `root`, `certificates.list`, `certificates.edit(id)`, `certificates.create`, `assignment`

### src/routes/sections/modules.tsx (MODIFIED)
1. Add lazy imports for new certificate pages
2. Add `path: 'certificate-management'` route group under dashboard (same wrapper as badge-management)
3. Add children routes:
   - `certificates/list`
   - `certificates/edit/new`
   - `certificates/edit/:id`
   - `assignment`
4. Wrap with `PermissionGuard` using Decision 1

### src/layouts/dashboard/config-navigation.tsx (MODIFIED)
1. Add a new "Certificates" navigation group mirroring "Badges":
   - child: Assignment
   - child: Certificates
2. Ensure `aliasPaths` include `/certificate-management`

### src/constants/permission-modules.ts (MODIFIED, conditional)
1. If Decision 1B: add `CERTIFICATE_MANAGEMENT: 'Certificates'`

## Blockers/Assumptions
- Backend permission module naming for certificates is unknown (Decision 1).
- DELETE/unassign endpoints cannot be validated in `API_MODE=safe-updates`; UI should still implement them and rely on server enforcement + confirmation dialogs.
- `criteriaType` enum values match badges (`single_activity`, `multiple_activities`); plan assumes reuse.
- Created test certificate exists in dev:
  - `b19ce1ee-aab6-4751-ba7b-74928032a04b` (safe-updates prevents deletion via wrapper; cleanup requires `API_MODE=full-access` or manual admin cleanup).

