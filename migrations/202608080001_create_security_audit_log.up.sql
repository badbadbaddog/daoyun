CREATE TABLE security_audit_log (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    session_id uuid REFERENCES sessions (id) ON DELETE SET NULL,
    event_type varchar(64) NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT security_audit_event_type_length CHECK (char_length(event_type) BETWEEN 1 AND 64),
    CONSTRAINT security_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX security_audit_user_time_index
    ON security_audit_log (user_id, created_at DESC, id DESC);

CREATE INDEX security_audit_session_time_index
    ON security_audit_log (session_id, created_at DESC, id DESC);

CREATE INDEX security_audit_event_time_index
    ON security_audit_log (event_type, created_at DESC, id DESC);
