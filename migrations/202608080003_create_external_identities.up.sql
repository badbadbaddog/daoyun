CREATE TABLE external_identities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider_key varchar(32) NOT NULL,
    subject varchar(255) NOT NULL,
    issuer varchar(2048) NOT NULL,
    email_snapshot varchar(254),
    email_verified boolean,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_authenticated_at timestamptz,
    CONSTRAINT external_identity_provider_key_format CHECK (
        provider_key ~ '^[a-z][a-z0-9_-]{1,31}$'
    ),
    CONSTRAINT external_identity_subject_length CHECK (
        char_length(subject) BETWEEN 1 AND 255
    ),
    CONSTRAINT external_identity_issuer_length CHECK (
        char_length(issuer) BETWEEN 1 AND 2048
    ),
    CONSTRAINT external_identity_email_length CHECK (
        email_snapshot IS NULL OR char_length(email_snapshot) BETWEEN 3 AND 254
    )
);

CREATE UNIQUE INDEX external_identities_provider_subject_unique
    ON external_identities (provider_key, subject);
CREATE INDEX external_identities_user_index
    ON external_identities (user_id, created_at, id);
