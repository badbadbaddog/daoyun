DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE permission_key = 'admin.users.read');
DELETE FROM permissions WHERE permission_key = 'admin.users.read';

DROP INDEX posts_admin_author_created_index;
DROP INDEX topics_admin_author_created_index;
DROP INDEX users_admin_created_index;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE status = 'restricted'
           OR restriction_reason IS NOT NULL
           OR restriction_expires_at IS NOT NULL
           OR admin_revision <> 1
    ) THEN
        RAISE EXCEPTION 'cannot roll back admin user read model while administrative user state exists';
    END IF;
END
$$;

ALTER TABLE users
    DROP CONSTRAINT users_restriction_reason_length,
    DROP CONSTRAINT users_admin_revision_positive,
    DROP CONSTRAINT users_status_valid;
ALTER TABLE users
    ADD CONSTRAINT users_status_valid CHECK (status IN ('active', 'suspended'));

ALTER TABLE users
    DROP COLUMN restriction_expires_at,
    DROP COLUMN restriction_reason,
    DROP COLUMN admin_revision;
