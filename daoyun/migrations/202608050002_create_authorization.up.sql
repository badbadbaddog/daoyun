CREATE TABLE permissions (
    id uuid PRIMARY KEY,
    permission_key varchar(96) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    description varchar(255) NOT NULL DEFAULT '',
    is_system boolean NOT NULL DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT permissions_key_format CHECK (
        permission_key ~ '^[a-z][a-z0-9_.]{1,95}$'
    ),
    CONSTRAINT permissions_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT permissions_description_length CHECK (char_length(description) <= 255)
);

CREATE TABLE role_permissions (
    role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id)
);

ALTER TABLE role_assignments
    ADD COLUMN scope_id uuid;

ALTER TABLE role_assignments
    DROP CONSTRAINT role_assignments_user_role_unique;

CREATE UNIQUE INDEX role_assignments_user_role_scope_unique
    ON role_assignments (
        user_id,
        role_id,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

CREATE INDEX role_assignments_scope_index
    ON role_assignments (scope_id, user_id, role_id)
    WHERE scope_id IS NOT NULL;

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (gen_random_uuid(), 'admin.configuration.read', 'Read administration configuration', 'Read protected administration configuration.'),
    (gen_random_uuid(), 'admin.configuration.write', 'Write administration configuration', 'Change site branding and board configuration.'),
    (gen_random_uuid(), 'governance.reports.read', 'Read content reports', 'Read the moderation report queue.'),
    (gen_random_uuid(), 'governance.reports.resolve', 'Resolve content reports', 'Resolve reports and apply moderation actions.'),
    (gen_random_uuid(), 'moderation.topic', 'Moderate topics', 'Approve, hide, or reject topics.'),
    (gen_random_uuid(), 'audit.read', 'Read administration audit', 'Read immutable administration audit records.'),
    (gen_random_uuid(), 'attachment.create', 'Create attachments', 'Create pending attachment metadata for an owned topic.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
ON CONFLICT DO NOTHING;
