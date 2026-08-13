DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id
    FROM permissions
    WHERE permission_key IN (
        'authorization.roles.read',
        'authorization.roles.write',
        'authorization.assignments.read',
        'authorization.assignments.write'
    )
);

DELETE FROM permissions
WHERE permission_key IN (
    'authorization.roles.read',
    'authorization.roles.write',
    'authorization.assignments.read',
    'authorization.assignments.write'
);

ALTER TABLE roles
    DROP CONSTRAINT roles_revision_positive,
    DROP COLUMN revision;
