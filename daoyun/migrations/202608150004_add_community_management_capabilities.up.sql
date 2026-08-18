INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (daoyun_uuid_v7(), 'community.groups.read', 'Read community groups', 'Read community group permission and quota configuration.'),
    (daoyun_uuid_v7(), 'community.groups.write', 'Write community groups', 'Create and update community group permission and quota configuration.'),
    (daoyun_uuid_v7(), 'community.memberships.read', 'Read community memberships', 'Read user community group memberships.'),
    (daoyun_uuid_v7(), 'community.memberships.write', 'Write community memberships', 'Grant and revoke user community group memberships.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.key = 'super_admin'
  AND permissions.permission_key IN (
      'community.groups.read',
      'community.groups.write',
      'community.memberships.read',
      'community.memberships.write'
  )
ON CONFLICT DO NOTHING;
