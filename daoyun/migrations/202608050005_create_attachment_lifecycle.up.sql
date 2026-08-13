ALTER TABLE topic_attachments
    ADD COLUMN scan_status varchar(16) NOT NULL DEFAULT 'clean',
    ADD COLUMN scanned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN expires_at timestamptz,
    ADD COLUMN deleted_at timestamptz,
    ADD CONSTRAINT topic_attachments_scan_status_valid
        CHECK (scan_status IN ('pending', 'clean', 'infected', 'error'));

CREATE INDEX topic_attachments_cleanup_index
    ON topic_attachments (status, expires_at, deleted_at, created_at);

INSERT INTO permissions (id, permission_key, name, description)
VALUES (
    gen_random_uuid(),
    'attachment.cleanup',
    'Clean attachment objects',
    'Remove expired attachment metadata and orphaned local objects.'
)
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key = 'attachment.cleanup'
ON CONFLICT DO NOTHING;
