DELETE FROM role_permissions AS role_permission
USING roles AS role, permissions AS permission
WHERE role_permission.role_id = role.id
  AND role_permission.permission_id = permission.id
  AND role.key = 'board_moderator'
  AND permission.permission_key IN (
      'moderation.topic',
      'moderation.topic.pin',
      'moderation.topic.feature',
      'moderation.topic.lock',
      'moderation.topic.move',
      'moderation.user.restrict_in_scope'
  );

DELETE FROM roles AS role
WHERE role.key = 'board_moderator'
  AND role.scope = 'board'
  AND NOT role.is_system
  AND NOT EXISTS (
      SELECT 1
      FROM role_assignments AS assignment
      WHERE assignment.role_id = role.id
  );
