CREATE TABLE operations_alert_rules (
    id uuid PRIMARY KEY,
    key varchar(64) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    kind varchar(32) NOT NULL UNIQUE,
    threshold bigint NOT NULL,
    window_seconds integer NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT operations_alert_rules_key_format CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT operations_alert_rules_name_nonempty CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT operations_alert_rules_kind_valid CHECK (kind IN (
        'http_5xx_count',
        'http_p95_ms',
        'outbox_dead_count',
        'risk_alert_open_count'
    )),
    CONSTRAINT operations_alert_rules_threshold_range CHECK (threshold BETWEEN 0 AND 1000000000),
    CONSTRAINT operations_alert_rules_window_range CHECK (window_seconds BETWEEN 30 AND 86400),
    CONSTRAINT operations_alert_rules_revision_positive CHECK (revision > 0)
);

CREATE TABLE operations_alerts (
    id uuid PRIMARY KEY,
    rule_id uuid NOT NULL REFERENCES operations_alert_rules(id) ON DELETE RESTRICT,
    status varchar(16) NOT NULL DEFAULT 'open',
    observed_value bigint NOT NULL,
    threshold bigint NOT NULL,
    first_triggered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at timestamptz,
    resolved_at timestamptz,
    CONSTRAINT operations_alerts_status_valid CHECK (status IN ('open', 'acknowledged', 'resolved')),
    CONSTRAINT operations_alerts_values_nonnegative CHECK (observed_value >= 0 AND threshold >= 0),
    CONSTRAINT operations_alerts_time_order CHECK (last_triggered_at >= first_triggered_at),
    CONSTRAINT operations_alerts_state_consistent CHECK (
        (status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND resolved_at IS NULL)
        OR (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_at IS NULL)
        OR (status = 'resolved' AND resolved_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX operations_alerts_active_rule_unique
    ON operations_alerts (rule_id)
    WHERE status IN ('open', 'acknowledged');

CREATE INDEX operations_alerts_status_time_index
    ON operations_alerts (status, last_triggered_at DESC, id DESC);

INSERT INTO operations_alert_rules (id, key, name, kind, threshold, window_seconds)
VALUES
    ('019fed00-0000-7000-8000-000000000001', 'api_5xx', 'API 5xx 错误', 'http_5xx_count', 10, 300),
    ('019fed00-0000-7000-8000-000000000002', 'api_p95', 'API P95 延迟', 'http_p95_ms', 1000, 300),
    ('019fed00-0000-7000-8000-000000000003', 'outbox_dead', 'Outbox 死信', 'outbox_dead_count', 1, 300),
    ('019fed00-0000-7000-8000-000000000004', 'risk_alerts', '未处理风险告警', 'risk_alert_open_count', 10, 300);

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (
        gen_random_uuid(),
        'operations.read',
        'Read operations monitoring',
        'Read operational summaries, alert rules, and alert incidents.'
    ),
    (
        gen_random_uuid(),
        'operations.alerts.write',
        'Manage operations alerts',
        'Update operational alert rules and acknowledge alert incidents.'
    )
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN ('operations.read', 'operations.alerts.write')
ON CONFLICT DO NOTHING;
