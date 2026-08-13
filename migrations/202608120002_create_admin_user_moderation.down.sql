DELETE FROM role_permissions
WHERE permission_id = (
    SELECT id FROM permissions WHERE permission_key = 'admin.users.moderate'
);

DELETE FROM permissions WHERE permission_key = 'admin.users.moderate';
