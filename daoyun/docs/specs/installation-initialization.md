# Spec: One-Time Installation Initialization

## Objective

Provide the one-time write path for a fresh DaoYun instance. The endpoint creates the first user, stores an Argon2id password credential, grants the instance-level `super_admin` role, and marks `system_state` initialized in one PostgreSQL transaction.

## Tech Stack

- Rust 1.94.1, Axum 0.8.9, SQLx 0.9.0, utoipa 5.5.0.
- RustCrypto `argon2` 0.5.3 for salted Argon2id PHC hashes.
- `email_address` 0.2.9 for RFC-aware email syntax validation.
- PostgreSQL row locking and transactions for the one-time invariant.

## Contract

`POST /api/v1/installation`

```json
{
  "username": "owner",
  "email": "owner@example.com",
  "display_name": "站点管理员",
  "password": "correct horse battery staple"
}
```

- `username`: 3-32 characters; starts with a lowercase ASCII letter; remaining characters are lowercase ASCII letters, digits, or `_`.
- `email`: trimmed, RFC-valid, and no longer than 254 characters.
- `display_name`: trimmed, 1-80 Unicode characters, and contains no control characters.
- `password`: 6-128 Unicode characters; it is never trimmed, returned, or logged.
- Request bodies over 4 KiB and malformed JSON are rejected through the shared error envelope.

Successful response (`201`):

```json
{
  "data": {
    "is_initialized": true,
    "administrator": {
      "id": "019fc700-0000-7000-8000-000000000001",
      "username": "owner",
      "email": "owner@example.com",
      "display_name": "站点管理员"
    }
  },
  "meta": {
    "request_id": "019fc59d-f66c-7501-9e2a-3670d0904ea6"
  }
}
```

Errors:

- `409 installation.already_initialized`: initialization has already completed; no account data is returned.
- `422 request.validation_failed`: malformed JSON or invalid fields; field messages use the shared `fields` map.
- `500 system.internal_error`: password preparation failed; no cryptographic details are exposed.
- `503 system.database_unavailable`: database reads or the initialization transaction failed; no SQLx details are exposed.
- Every response carries the same UUIDv7 in `meta.request_id` and `x-request-id`.

## Persistence And Concurrency

- Add `users`, `password_credentials`, `roles`, and `role_assignments` with a reversible migration.
- Generate all entity identifiers as UUIDv7 values in the application.
- Produce a uniquely salted Argon2id v19 PHC string before opening the write transaction.
- Bound in-process password hashing to one initialization attempt at a time and run CPU work on Tokio's blocking pool.
- In the transaction, lock the `system_state` singleton with `SELECT ... FOR UPDATE` before any insert.
- Insert the administrator, credential, `super_admin` role, and assignment before updating `system_state`.
- Commit only after all writes succeed. Dropping a failed SQLx transaction must roll back every partial write.
- The database lock is authoritative across processes: concurrent valid requests produce exactly one `201`; all later contenders receive `409`.

## Commands

- Test: `cargo test --workspace`
- Format: `cargo fmt --all -- --check`
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`
- Run: `cargo run -p daoyun-api`

## Project Structure And Code Style

- Public DTOs: `crates/api-contract/src/installation.rs`.
- Migration: `migrations/202608030003_create_identity_foundation.{up,down}.sql`.
- Transaction: `crates/infrastructure/src/installation.rs`.
- Validation, hashing, HTTP mapping, and OpenAPI: `apps/api/src/installation.rs`.

```rust
let administrator = database
    .initialize_installation(input)
    .await
    .map_err(|error| map_initialization_error(error, request_id))?;
```

- Keep persistence records out of the public contract.
- Use parameterized SQL and shared response/error envelopes.
- Cite version-specific APIs with direct official documentation URLs.

## Testing Strategy

- Contract tests lock request and success response serialization without exposing the password.
- SQLx integration tests verify the schema, success state, role grant, single-winner concurrency, and rollback on a forced late failure.
- API tests verify validation, Argon2id storage, correlation, conflict behavior, error secrecy, and OpenAPI responses/schemas.
- Existing workspace tests, rustfmt, and Clippy must remain green.

## Boundaries

- Always: validate before hashing, parameterize SQL, hash outside the transaction, lock before writes, and keep secrets out of logs and responses.
- Ask first: changing the published path or fields, creating a session during installation, or expanding this endpoint into site branding setup.
- Never: store plaintext passwords, infer initialization from files, reset an initialized instance, or leave partial identity records after failure.

## Success Criteria

- A fresh database accepts one valid request and returns a correlated `201` response.
- The stored password is a salted Argon2id v19 PHC hash and verifies against the submitted password.
- Exactly one of two concurrent requests succeeds; the other returns `409` without extra users or grants.
- Any late transaction failure leaves `system_state.is_initialized = false` and all four identity tables empty.
- Invalid inputs never start password hashing or database writes.
- Successful initialization creates the `general` public board in the same transaction.
- OpenAPI documents request, success, validation, conflict, internal, and unavailable responses.

## Open Questions

None. Session creation remains part of registration/login, while site branding remains a separate slice.
Default-board creation was added by `topic-publishing.md` so every initialized instance has a valid
publishing target.
