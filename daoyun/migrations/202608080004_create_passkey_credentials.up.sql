CREATE TABLE passkey_credentials (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id bytea NOT NULL,
    credential jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamptz,
    CONSTRAINT passkey_credential_id_length CHECK (
        octet_length(credential_id) BETWEEN 1 AND 1023
    )
);

CREATE UNIQUE INDEX passkey_credentials_credential_id_unique
    ON passkey_credentials (credential_id);
CREATE INDEX passkey_credentials_user_index
    ON passkey_credentials (user_id, created_at DESC, id DESC);

CREATE TABLE passkey_challenges (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users (id) ON DELETE CASCADE,
    session_id uuid REFERENCES sessions (id) ON DELETE CASCADE,
    kind varchar(16) NOT NULL,
    state jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT passkey_challenge_kind_valid CHECK (kind IN ('registration', 'assertion')),
    CONSTRAINT passkey_challenge_context_valid CHECK (
        (kind = 'registration' AND user_id IS NOT NULL AND session_id IS NOT NULL)
        OR (kind = 'assertion' AND user_id IS NULL AND session_id IS NULL)
    ),
    CONSTRAINT passkey_challenge_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT passkey_challenge_consumed_after_creation CHECK (
        consumed_at IS NULL OR consumed_at >= created_at
    )
);

CREATE INDEX passkey_challenges_expiry_index
    ON passkey_challenges (expires_at)
    WHERE consumed_at IS NULL;
