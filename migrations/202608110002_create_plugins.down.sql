DROP TABLE plugins;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id
    FROM permissions
    WHERE permission_key IN (
        'plugins.read',
        'plugins.install',
        'plugins.lifecycle',
        'plugins.invoke'
    )
);

DELETE FROM permissions
WHERE permission_key IN (
    'plugins.read',
    'plugins.install',
    'plugins.lifecycle',
    'plugins.invoke'
);
