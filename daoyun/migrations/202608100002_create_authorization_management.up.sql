ALTER TABLE roles
    ADD COLUMN revision bigint NOT NULL DEFAULT 1,
    ADD CONSTRAINT roles_revision_positive CHECK (revision > 0);

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (
        gen_random_uuid(),
        'authorization.roles.read',
        'Read authorization roles',
        'Read the role and permission catalog.'
    ),
    (
        gen_random_uuid(),
        'authorization.roles.write',
        'Manage authorization roles',
        'Create, update, and delete custom roles.'
    ),
    (
        gen_random_uuid(),
        'authorization.assignments.read',
        'Read role assignments',
        'Read user role assignments and their scopes.'
    ),
    (
        gen_random_uuid(),
        'authorization.assignments.write',
        'Manage role assignments',
        'Grant and revoke custom role assignments.'
    )
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'authorization.roles.read',
      'authorization.roles.write',
      'authorization.assignments.read',
      'authorization.assignments.write'
  )
ON CONFLICT DO NOTHING;
