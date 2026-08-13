# RBAC and ABAC authorization foundation

## Goal

Provide one server-side capability check for role-based permissions and resource-scoped attributes without changing the public API envelope.

## Model

- `permissions` stores stable capability keys.
- `role_permissions` maps roles to capabilities.
- `role_assignments.scope_id` is null for instance/site roles and contains the board identifier for board-scoped roles.
- A capability is granted only when the user is active, the role is assigned, and the role scope matches the optional resource scope.
- Instance and site roles are global. Board roles require an exact board scope match.
- Resource ownership and content state remain ABAC checks in the mutation transaction, so an owner cannot edit another user's resource and hidden/deleted resources are denied.

## Initial capability set

- `admin.configuration.read`
- `admin.configuration.write`
- `governance.reports.read`
- `governance.reports.resolve`
- `moderation.topic`
- `audit.read`
- `attachment.create`

The first installed administrator receives the `super_admin` role and all system capabilities in the same transaction. Existing installations are backfilled by the migration.

## Acceptance criteria

- Permission and role-scope tables have reversible migrations and stable uniqueness constraints.
- Suspended users cannot satisfy any capability check.
- A board-scoped assignment cannot authorize access to another board.
- Administrative and topic moderation routes use capability checks rather than a role-name comparison.
- Authorization failures use the existing `403` error envelope and do not expose database details.

Governance notifications use the existing notification center and are emitted only after a report transaction has committed its intended state: active users with `governance.reports.read` receive new-report notifications, and active reporters receive a resolution notification.

## Fine-grained authorization management

### Objective

Allow a trusted administrator to compose custom roles from the fixed capability catalog and assign those roles to users at the instance/site or board scope. The feature replaces UI-level `super_admin` assumptions with capability-driven access while keeping the existing server-side RBAC/ABAC evaluation model.

The first delivery is intentionally not a general policy language. Resource ownership, visibility and lifecycle state continue to be checked as ABAC conditions inside the corresponding business transaction.

### Assumptions and scope

- `super_admin` and every other `is_system = true` role are readable but immutable through the new API.
- System-role assignments are not created or removed through the new API. Root administrator recovery remains an installation/operations concern.
- Permission keys are defined by application migrations and are never created, renamed or deleted from the UI.
- Custom role keys and scopes are immutable after creation. A role name and its permission set can be changed.
- Instance and site assignments must have `scope_id = null`; board assignments must reference an existing board.
- The first UI accepts an exact username when granting a role. User-directory search is outside this slice.
- No organization, group inheritance, deny rule, time window or expression-based policy is introduced.

### Public admin contract

All endpoints use the existing versioned response envelope, return the same `request_id` in the body and `x-request-id` header, use Cookie sessions, and define their OpenAPI contract.

`GET /api/v1/admin/access` is available to any authenticated user and returns only the caller's active instance/site capability keys. It is the capability-driven administration shell bootstrap and never returns role assignments, board-scoped grants, private identity fields or session data.

Read endpoints require `authorization.roles.read` or `authorization.assignments.read` as appropriate:

- `GET /api/v1/admin/authorization/permissions`
- `GET /api/v1/admin/authorization/roles`
- `GET /api/v1/admin/authorization/assignments?username=&role_id=&scope_id=&cursor=&limit=`

Mutation endpoints require the corresponding write capability plus session-bound CSRF:

- `POST /api/v1/admin/authorization/roles`
- `PATCH /api/v1/admin/authorization/roles/{role_id}`
- `DELETE /api/v1/admin/authorization/roles/{role_id}`
- `POST /api/v1/admin/authorization/assignments`
- `DELETE /api/v1/admin/authorization/assignments/{assignment_id}`

Role responses contain `id`, `key`, `name`, `scope`, `is_system`, `permission_keys`, `assignment_count`, `revision`, `created_at` and `updated_at`. Assignment responses contain `id`, a public user summary, the role summary, optional `scope_id`, the public assigner summary and `created_at`. They never expose email, credential, session or upstream identity data.

Create-role input contains `key`, `name`, `scope` and a non-empty unique `permission_keys` array. Update-role input contains `name`, `permission_keys` and `expected_revision`. Assignment input contains `username`, `role_id` and optional `scope_id`.

### Stable errors

- `authorization.role_not_found`: the role does not exist or is not visible to the operation.
- `authorization.role_conflict`: the key already exists or the optimistic revision is stale.
- `authorization.role_system_managed`: a mutation targets a system role.
- `authorization.role_in_use`: deletion targets a role with assignments.
- `authorization.permission_invalid`: one or more permission keys do not exist, are duplicated or exceed the actor's grant ceiling.
- `authorization.assignment_not_found`: the assignment does not exist.
- `authorization.assignment_conflict`: the user already has the same role at the same scope.
- `authorization.scope_invalid`: role and assignment scope do not match or the board does not exist.
- `authorization.user_not_found`: the exact active username cannot be resolved.

Unknown resources and cross-account details use the same generic errors where disclosure would reveal information. Database details never enter responses.

### Authorization and privilege-escalation boundaries

- Add fixed capabilities `authorization.roles.read`, `authorization.roles.write`, `authorization.assignments.read` and `authorization.assignments.write`; migrations grant them to `super_admin`.
- Authorization-management capabilities are valid only from an instance/site assignment. A board-scoped role cannot administer the global role catalog or assignments.
- A mutation actor may only add permission keys that the actor currently holds through an instance/site assignment. Possessing `authorization.roles.write` alone does not allow granting unrelated capabilities.
- Assignment creation additionally checks that every capability in the target role is within the actor's current instance/site grant ceiling.
- Role permission replacement, role revision increment and audit insertion occur in one PostgreSQL transaction.
- Assignment creation/deletion and audit insertion occur in one PostgreSQL transaction.
- Authorization is rechecked in the mutation transaction so a concurrent privilege revocation cannot authorize a stale write.
- Suspended target users cannot receive new assignments. Suspended actors never satisfy capability checks.

### Data model

- Add `roles.revision bigint NOT NULL DEFAULT 1` with a positive check.
- Keep the existing role key uniqueness and assignment uniqueness constraints.
- Seed the four authorization-management capabilities and grant them to `super_admin` reversibly.
- Keep scope integrity in the transactional write service because it depends on both `roles.scope` and board existence.
- Do not cascade-delete a role through the API; return `authorization.role_in_use` while assignments exist.

### Audit and observability

Write minimal `admin_audit_log` entries with actions `authorization.role.create`, `authorization.role.update`, `authorization.role.delete`, `authorization.assignment.create` and `authorization.assignment.delete`. Summaries may include role key, scope, permission keys and target username, but never email, tokens, credential state or session identifiers.

Authorization denials remain structured application logs with `request_id`; metrics and distributed tracing are part of the separate operations-observability slice.

### Management UI

- Add an “角色与权限” tab to the existing administration view.
- Show the fixed permission catalog grouped by capability prefix and distinguish read/write or action capabilities by label.
- List system roles as read-only and custom roles with edit/delete actions.
- Create and edit forms use semantic labels, field errors, confirmation for deletion and no icon-only action without an accessible label and tooltip.
- Assignment management accepts an exact username, role and the required board when the role scope is `board`.
- The UI handles loading, empty, forbidden, conflict and retry states at 320, 768, 1024 and 1440 pixel widths.
- The administration entry first reads `/api/v1/admin/access`, displays only tabs whose read capabilities are present and loads only their corresponding data. The client may hide unavailable controls for usability, but every API remains authoritative.

### Tech stack and project structure

- Rust DTOs and OpenAPI schemas: `crates/api-contract/src/admin.rs`.
- PostgreSQL transactions and authorization queries: `crates/infrastructure/src/authorization.rs` plus a reversible migration.
- Axum routes and boundary validation: `apps/api/src/admin.rs`.
- Generated TypeScript contract: `src/api/generated.d.ts`; it is regenerated and never hand-edited.
- Runtime client mapping: `src/api/admin.ts`.
- React management UI: `src/components/AdminView.tsx` with colocated tests.
- Browser regression: `e2e/local-business-flow.spec.ts` or a focused authorization administration spec.

Rust public DTOs remain separate from persistence records. React components use named exports, server-shaped values stay in the API layer, and UI colors use the semantic tokens in `src/styles.css`.

### Testing strategy

- Migration tests cover forward/backward application, capability seeds, positive revisions and uniqueness constraints.
- Infrastructure tests cover scoped reads, permission replacement, optimistic conflicts, role-in-use deletion, exact assignment uniqueness, board scope validation, suspended users, audit atomicity and concurrent privilege revocation.
- API/OpenAPI tests cover `/admin/access`, authentication, CSRF, each capability boundary, field validation, stable errors, request ID correlation and absence of private user data.
- Frontend tests cover runtime DTO rejection, role forms, system-role read-only behavior, board scope input, conflicts and forbidden states.
- Real Chromium tests cover creating a limited moderator role, assigning it to `demo_member`, proving access to the permitted operation, proving denial of an unrelated operation, revoking the assignment and proving access is removed.

### Commands

```powershell
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm generate:api -- --check
pnpm test
pnpm typecheck
pnpm build
$env:DAOYUN_LOCAL_E2E = "1"
pnpm test:e2e
```

### Boundaries

- Always: validate and normalize at the API boundary, reauthorize inside mutations, use transactions for state plus audit, and define OpenAPI for every endpoint.
- Ask first: making system roles mutable, allowing delegation beyond the actor's effective capabilities, adding a policy language, or adding a new dependency.
- Never: authorize from client state, compare only the `super_admin` role name at a business route, return private identity fields, or silently cascade-delete active assignments.

### Success criteria

- A super administrator can create a custom board moderator role, assign it to an active user for one board and revoke it from the administration UI.
- The assigned user can perform exactly the granted board-scoped capability and is denied on another board or for an ungranted capability.
- A delegated role manager cannot grant a permission they do not hold globally.
- System roles remain immutable, role updates reject stale revisions and assigned roles cannot be deleted.
- Every successful mutation is atomically audited and all public endpoints have tested OpenAPI/request-ID contracts.
- Rust, frontend and real desktop/mobile browser quality gates pass.

## Implementation plan

### Task 1: Schema and permission seeds

- Add the role revision column and four fixed management capabilities with reversible migration coverage.
- Verify with migration up/down tests and `cargo test -p infrastructure --test database`.

### Task 2: Read-only authorization catalog

- Add infrastructure records/queries, public DTOs and the three read endpoints.
- Verify scoped capability checks, response privacy, OpenAPI and request-ID tests.

### Task 3: Custom role mutations

- Add create/update/delete transactions with grant-ceiling checks, optimistic revision and atomic audit.
- Verify system-role protection, invalid permissions, conflicts, concurrent revocation and role-in-use behavior.

### Task 4: Assignment mutations

- Add exact-username assignment and revocation transactions with scope and suspended-user validation.
- Verify board isolation, uniqueness, capability ceiling, CSRF and audit rollback.

### Task 5: TypeScript client and management UI

- Regenerate the OpenAPI declaration, add runtime response validation and implement the responsive “角色与权限” panel.
- Verify component behavior, accessibility labels, loading/error/conflict states, type checking and production build.

### Task 6: Real authorization regression and documentation

- Add a loopback-only Chromium role/create/assign/deny/revoke flow and update project status.
- Verify desktop/mobile E2E, full Rust/frontend gates and a five-axis code review.
