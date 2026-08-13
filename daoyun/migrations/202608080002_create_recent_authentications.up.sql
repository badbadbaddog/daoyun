ALTER TABLE sessions
    ADD CONSTRAINT sessions_id_user_unique UNIQUE (id, user_id);

CREATE TABLE recent_authentications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    operation varchar(64) NOT NULL,
    method varchar(32) NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT recent_auth_session_user_fkey FOREIGN KEY (session_id, user_id)
        REFERENCES sessions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT recent_auth_operation_length CHECK (char_length(operation) BETWEEN 1 AND 64),
    CONSTRAINT recent_auth_method_length CHECK (char_length(method) BETWEEN 1 AND 32),
    CONSTRAINT recent_auth_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT recent_auth_consumed_after_creation CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX recent_auth_active_operation_index
    ON recent_authentications (session_id, operation)
    WHERE consumed_at IS NULL;

CREATE INDEX recent_auth_user_time_index
    ON recent_authentications (user_id, created_at DESC, id DESC);

CREATE INDEX recent_auth_expiry_index
    ON recent_authentications (expires_at)
    WHERE consumed_at IS NULL;
