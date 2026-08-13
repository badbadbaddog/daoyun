ALTER TABLE sessions
    ADD COLUMN device_label varchar(80) NOT NULL DEFAULT '未知设备',
    ADD CONSTRAINT sessions_device_label_valid CHECK (
        char_length(device_label) BETWEEN 1 AND 80
        AND device_label !~ '[[:cntrl:]]'
    );

CREATE INDEX sessions_user_active_last_seen_index
    ON sessions (user_id, last_seen_at DESC, id DESC)
    WHERE revoked_at IS NULL;
