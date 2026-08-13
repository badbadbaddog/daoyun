CREATE TABLE idempotency_records (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint varchar(160) NOT NULL,
    idempotency_key varchar(255) NOT NULL,
    request_hash bytea NOT NULL,
    resource_type varchar(64) NOT NULL,
    resource_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    CONSTRAINT idempotency_records_key_length CHECK (
        char_length(idempotency_key) BETWEEN 1 AND 255
    ),
    CONSTRAINT idempotency_records_hash_length CHECK (octet_length(request_hash) = 32),
    CONSTRAINT idempotency_records_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT idempotency_records_user_endpoint_key_unique
        UNIQUE (user_id, endpoint, idempotency_key)
);

CREATE INDEX idempotency_records_expiry_index ON idempotency_records (expires_at);
