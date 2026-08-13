DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE permission_key IN ('operations.read', 'operations.alerts.write')
);

DELETE FROM permissions
WHERE permission_key IN ('operations.read', 'operations.alerts.write');

DROP TABLE operations_alerts;
DROP TABLE operations_alert_rules;
