DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key IN (
        'community.groups.read',
        'community.groups.write',
        'community.memberships.read',
        'community.memberships.write'
    )
);

DELETE FROM permissions
WHERE permission_key IN (
    'community.groups.read',
    'community.groups.write',
    'community.memberships.read',
    'community.memberships.write'
);
