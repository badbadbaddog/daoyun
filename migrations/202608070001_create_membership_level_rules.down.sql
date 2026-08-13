DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key IN (
        'membership.rules.read',
        'membership.rules.write',
        'membership.points.grant'
    )
);

DELETE FROM permissions
WHERE permission_key IN (
    'membership.rules.read',
    'membership.rules.write',
    'membership.points.grant'
);

DROP TABLE membership_level_rules;
