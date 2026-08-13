DROP INDEX sessions_user_active_last_seen_index;

ALTER TABLE sessions
    DROP CONSTRAINT sessions_device_label_valid,
    DROP COLUMN device_label;
