DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE permission_key = 'attachment.cleanup'
);
DELETE FROM permissions WHERE permission_key = 'attachment.cleanup';
DROP INDEX topic_attachments_cleanup_index;
ALTER TABLE topic_attachments
    DROP CONSTRAINT topic_attachments_scan_status_valid,
    DROP COLUMN deleted_at,
    DROP COLUMN expires_at,
    DROP COLUMN scanned_at,
    DROP COLUMN scan_status;
