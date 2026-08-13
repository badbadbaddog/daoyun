CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL,
    csrf_token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT sessions_csrf_token_hash_length CHECK (octet_length(csrf_token_hash) = 32),
    CONSTRAINT sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at),
    CONSTRAINT sessions_last_seen_before_idle_expiry CHECK (last_seen_at <= idle_expires_at)
);

CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
CREATE INDEX sessions_user_active_index ON sessions (user_id)
    WHERE revoked_at IS NULL;
