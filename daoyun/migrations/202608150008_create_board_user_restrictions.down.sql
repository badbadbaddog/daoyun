DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key = 'moderation.user.restrict_in_scope'
);

DELETE FROM permissions
WHERE permission_key = 'moderation.user.restrict_in_scope';

DROP TABLE board_user_restrictions;

ALTER TABLE roles
    DROP CONSTRAINT roles_protection_level_valid,
    DROP COLUMN protection_level;
