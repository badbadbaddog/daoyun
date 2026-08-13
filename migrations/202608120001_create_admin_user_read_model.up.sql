ALTER TABLE users
    ADD COLUMN admin_revision bigint NOT NULL DEFAULT 1,
    ADD COLUMN restriction_reason varchar(500),
    ADD COLUMN restriction_expires_at timestamptz;

ALTER TABLE users DROP CONSTRAINT users_status_valid;
ALTER TABLE users
    ADD CONSTRAINT users_status_valid CHECK (status IN ('active', 'restricted', 'suspended')),
    ADD CONSTRAINT users_admin_revision_positive CHECK (admin_revision >= 1),
    ADD CONSTRAINT users_restriction_reason_length CHECK (
        restriction_reason IS NULL OR char_length(restriction_reason) BETWEEN 2 AND 500
    );

CREATE INDEX users_admin_created_index ON users (created_at DESC, id DESC);
CREATE INDEX topics_admin_author_created_index ON topics (author_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX posts_admin_author_created_index ON posts (author_id, created_at DESC, id DESC)
    WHERE kind = 'reply' AND deleted_at IS NULL;

INSERT INTO permissions (id, permission_key, name, description)
VALUES (
    gen_random_uuid(),
    'admin.users.read',
    'Read managed users',
    'Search users and read their management context.'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin' AND permission.permission_key = 'admin.users.read'
ON CONFLICT DO NOTHING;
