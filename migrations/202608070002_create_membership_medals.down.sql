DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key IN (
        'membership.medals.read',
        'membership.medals.grant',
        'membership.medals.rules.write'
    )
);

DROP TABLE IF EXISTS membership_medals;
DROP TABLE IF EXISTS membership_medal_rules;
DELETE FROM permissions WHERE permission_key IN (
    'membership.medals.read',
    'membership.medals.grant',
    'membership.medals.rules.write'
);
