# Spec: Installation Status API

## Objective

Expose the minimum public state needed by the Web installer to decide whether a new DaoYun instance must enter setup. This slice is read-only; administrator creation and one-time initialization remain a separate transactional feature.

## Tech Stack

- Rust 1.94.1, Axum 0.8.9, SQLx 0.9.0, utoipa 5.5.0.
- PostgreSQL `system_state` singleton as the source of truth.

## Contract

`GET /api/v1/installation`

```json
{
  "data": {
    "is_initialized": false
  },
  "meta": {
    "request_id": "019fc59d-f66c-7501-9e2a-3670d0904ea6"
  }
}
```

- `200`: returns the current singleton state.
- `503`: returns the shared `system.database_unavailable` error without database details.
- Every response carries the same UUIDv7 in `meta.request_id` and `x-request-id`.
- The endpoint is public and reveals no timestamps, account details, or schema information.

## Commands

- Test: `cargo test --workspace`
- Format: `cargo fmt --all -- --check`
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`
- Run: `cargo run -p daoyun-api`

## Project Structure And Style

- Public DTO: `crates/api-contract/src/installation.rs`.
- Persistence query: `crates/infrastructure/src/installation.rs`.
- HTTP route and OpenAPI: `apps/api/src/installation.rs`.
- Use named Rust types, snake_case JSON fields, the shared response envelope, and no persistence model in the public contract.

## Testing Strategy

- Contract test locks the serialized DTO shape.
- SQLx integration test checks both uninitialized and initialized database states.
- API tests check correlation, error secrecy, and OpenAPI documentation.

## Boundaries

- Always: read state from PostgreSQL and return the shared envelope.
- Ask first: changing the endpoint path or response shape after publication.
- Never: infer installation from files, mutate state in this endpoint, or expose database errors.

## Success Criteria

- A freshly migrated database returns `is_initialized: false`.
- An initialized database returns `is_initialized: true`.
- An unavailable database returns correlated `503` JSON with no SQLx or connection details.
- OpenAPI documents the `200` and `503` responses and `InstallationStatus` schema.

## Open Questions

None for this read-only slice.
