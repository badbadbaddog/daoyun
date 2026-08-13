CREATE TABLE mfa_totp (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret_ciphertext bytea NOT NULL,
    algorithm varchar(8) NOT NULL DEFAULT 'sha1',
    digits smallint NOT NULL DEFAULT 6,
    step_seconds integer NOT NULL DEFAULT 30,
    enabled boolean NOT NULL DEFAULT FALSE,
    setup_expires_at timestamptz,
    last_used_step bigint,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mfa_totp_algorithm_valid CHECK (algorithm = 'sha1'),
    CONSTRAINT mfa_totp_digits_valid CHECK (digits = 6),
    CONSTRAINT mfa_totp_step_valid CHECK (step_seconds = 30),
    CONSTRAINT mfa_totp_ciphertext_length CHECK (octet_length(secret_ciphertext) BETWEEN 32 AND 256),
    CONSTRAINT mfa_totp_setup_state_valid CHECK (enabled OR setup_expires_at IS NOT NULL)
);

CREATE TABLE mfa_recovery_codes (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash varchar(512) NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mfa_recovery_code_hash_argon2id CHECK (code_hash LIKE '$argon2id$v=19$%')
);

CREATE INDEX mfa_recovery_codes_user_state_index
    ON mfa_recovery_codes (user_id, used_at, created_at DESC, id DESC);

CREATE TABLE mfa_challenges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_label varchar(80) NOT NULL,
    browser_token_hash bytea NOT NULL,
    attempts smallint NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mfa_challenge_device_label_valid CHECK (
        char_length(device_label) BETWEEN 1 AND 80 AND device_label !~ '[[:cntrl:]]'
    ),
    CONSTRAINT mfa_challenge_browser_hash_length CHECK (octet_length(browser_token_hash) = 32),
    CONSTRAINT mfa_challenge_attempts_valid CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT mfa_challenge_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT mfa_challenge_consumed_after_creation CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX mfa_challenges_user_expiry_index
    ON mfa_challenges (user_id, expires_at DESC)
    WHERE consumed_at IS NULL;
