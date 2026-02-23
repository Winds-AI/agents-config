## Backend Development Workflow

### 1. Discovery
- Read relevant models from `src/models/` and migrations from `src/migrations/`
- Use MCP database tools if needed to check current data patterns

### 2. Context
- **Read `docs/PROJECT_PATTERNS.md`** and `.cursor/rules/` for established patterns
- Ask clarifying questions—don't assume requirements

### 3. Planning
- Write plan to `.agent/PLAN_<feature>.md` using `.agent/PLAN_TEMPLATE.md`
- **Wait for user approval before coding**

### 4. Implementation
- Update Swagger specs in `src/swagger/routes/` when changing API contracts
- Add validation in corresponding `validations/` folder

### 5. Migration (if schema changes)
- `npx sequelize-cli migration:generate --name <name>`
- Include `up` and `down` methods

### 6. Testing
- `source .agent/api-env.sh` then test with curl wrapper

---

## Bug/Issue Workflow

1. Use `redmine_getIssue` if user references an issue ID
2. Investigate and fix
3. **If user says "report back":** propose fix and wait for approval
4. **Otherwise:** implement directly

---

## Reminders
- Consider query performance and indexes for new queries
- Keep migrations reversible
