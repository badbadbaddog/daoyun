INSERT INTO roles (id, key, name, scope, is_system)
VALUES (daoyun_uuid_v7(), 'board_moderator', '版主', 'board', FALSE)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'board_moderator'
  AND role.scope = 'board'
  AND NOT role.is_system
  AND permission.permission_key IN (
      'moderation.topic',
      'moderation.topic.pin',
      'moderation.topic.feature',
      'moderation.topic.lock',
      'moderation.topic.move',
      'moderation.user.restrict_in_scope'
  )
ON CONFLICT DO NOTHING;
