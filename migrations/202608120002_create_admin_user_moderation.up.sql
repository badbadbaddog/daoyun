INSERT INTO permissions (id, permission_key, name, description)
VALUES (
    gen_random_uuid(),
    'admin.users.moderate',
    'Moderate managed users',
    'Restrict, suspend, and restore managed user accounts.'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key = 'admin.users.moderate';
