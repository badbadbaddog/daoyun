DROP TABLE risk_alerts;
DROP TABLE governance_policies;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key IN (
        'governance.policy.read', 'governance.policy.write',
        'governance.alerts.read', 'governance.alerts.resolve'
    )
);
DELETE FROM permissions
WHERE permission_key IN (
    'governance.policy.read', 'governance.policy.write',
    'governance.alerts.read', 'governance.alerts.resolve'
);
