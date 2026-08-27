CREATE TABLE smtp_configuration (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    host varchar(253) NOT NULL DEFAULT '',
    port integer NOT NULL DEFAULT 587,
    username varchar(320),
    password_ciphertext bytea,
    tls_mode varchar(16) NOT NULL DEFAULT 'starttls',
    from_email varchar(320) NOT NULL DEFAULT '',
    from_name varchar(120) NOT NULL DEFAULT 'DaoYun',
    enabled boolean NOT NULL DEFAULT FALSE,
    registration_email_verification_enabled boolean NOT NULL DEFAULT FALSE,
    updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT smtp_configuration_host_valid CHECK (
        char_length(host) <= 253 AND host !~ '[[:cntrl:]]'
    ),
    CONSTRAINT smtp_configuration_port_valid CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT smtp_configuration_username_valid CHECK (
        username IS NULL OR (
            char_length(username) BETWEEN 1 AND 320 AND username !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT smtp_configuration_password_valid CHECK (
        password_ciphertext IS NULL OR octet_length(password_ciphertext) BETWEEN 29 AND 2048
    ),
    CONSTRAINT smtp_configuration_tls_mode_valid CHECK (tls_mode IN ('tls', 'starttls', 'none')),
    CONSTRAINT smtp_configuration_from_email_valid CHECK (
        char_length(from_email) <= 320 AND from_email !~ '[[:cntrl:]]'
    ),
    CONSTRAINT smtp_configuration_from_name_valid CHECK (
        char_length(from_name) BETWEEN 1 AND 120 AND from_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT smtp_configuration_enabled_valid CHECK (
        NOT enabled OR (char_length(host) > 0 AND char_length(from_email) > 0)
    ),
    CONSTRAINT smtp_configuration_registration_valid CHECK (
        NOT registration_email_verification_enabled OR enabled
    )
);

INSERT INTO smtp_configuration (singleton) VALUES (TRUE);

CREATE TABLE registration_email_challenges (
    id uuid PRIMARY KEY,
    email varchar(320) NOT NULL,
    code_hash varchar(512) NOT NULL,
    code_ciphertext bytea,
    attempts smallint NOT NULL DEFAULT 0,
    delivered_at timestamptz,
    expires_at timestamptz NOT NULL,
    resend_after timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registration_email_challenges_email_valid CHECK (
        char_length(email) BETWEEN 3 AND 320
        AND email = lower(email)
        AND email !~ '[[:cntrl:][:space:]]'
    ),
    CONSTRAINT registration_email_challenges_hash_valid CHECK (
        code_hash LIKE '$argon2id$v=19$%'
    ),
    CONSTRAINT registration_email_challenges_ciphertext_valid CHECK (
        code_ciphertext IS NULL OR octet_length(code_ciphertext) BETWEEN 29 AND 128
    ),
    CONSTRAINT registration_email_challenges_attempts_valid CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT registration_email_challenges_expiry_valid CHECK (expires_at > created_at),
    CONSTRAINT registration_email_challenges_resend_valid CHECK (resend_after > created_at),
    CONSTRAINT registration_email_challenges_delivery_valid CHECK (
        delivered_at IS NULL OR delivered_at >= created_at
    ),
    CONSTRAINT registration_email_challenges_consumed_valid CHECK (
        consumed_at IS NULL OR consumed_at >= created_at
    )
);

CREATE INDEX registration_email_challenges_email_state_index
    ON registration_email_challenges (email, created_at DESC)
    WHERE consumed_at IS NULL;

CREATE INDEX registration_email_challenges_expiry_index
    ON registration_email_challenges (expires_at)
    WHERE consumed_at IS NULL;
