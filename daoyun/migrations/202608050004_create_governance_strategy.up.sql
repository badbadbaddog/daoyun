CREATE TABLE governance_policies (
    id smallint PRIMARY KEY DEFAULT 1,
    enabled boolean NOT NULL DEFAULT TRUE,
    alert_score_threshold smallint NOT NULL DEFAULT 70,
    reporter_window_minutes smallint NOT NULL DEFAULT 60,
    reporter_alert_limit smallint NOT NULL DEFAULT 5,
    updated_by uuid REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT governance_policies_singleton CHECK (id = 1),
    CONSTRAINT governance_policies_threshold_valid CHECK (alert_score_threshold BETWEEN 1 AND 100),
    CONSTRAINT governance_policies_window_valid CHECK (reporter_window_minutes BETWEEN 1 AND 1440),
    CONSTRAINT governance_policies_limit_valid CHECK (reporter_alert_limit BETWEEN 1 AND 100)
);

INSERT INTO governance_policies (id) VALUES (1);

CREATE TABLE risk_alerts (
    id uuid PRIMARY KEY,
    kind varchar(32) NOT NULL,
    severity varchar(16) NOT NULL,
    score smallint NOT NULL,
    target_type varchar(16),
    target_id uuid,
    reporter_id uuid REFERENCES users (id),
    report_id uuid REFERENCES content_reports (id),
    status varchar(16) NOT NULL DEFAULT 'open',
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    acknowledged_by uuid REFERENCES users (id),
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT risk_alerts_kind_valid CHECK (kind IN ('high_risk_report', 'reporter_spike')),
    CONSTRAINT risk_alerts_severity_valid CHECK (severity IN ('medium', 'high', 'critical')),
    CONSTRAINT risk_alerts_score_valid CHECK (score BETWEEN 1 AND 100),
    CONSTRAINT risk_alerts_target_type_valid CHECK (target_type IS NULL OR target_type IN ('topic', 'post')),
    CONSTRAINT risk_alerts_status_valid CHECK (status IN ('open', 'acknowledged', 'dismissed')),
    CONSTRAINT risk_alerts_ack_consistent CHECK (
        (status = 'open' AND acknowledged_at IS NULL)
        OR (status IN ('acknowledged', 'dismissed') AND acknowledged_at IS NOT NULL)
    )
);

CREATE INDEX risk_alerts_status_time_index ON risk_alerts (status, created_at DESC, id DESC);
CREATE INDEX risk_alerts_target_index ON risk_alerts (target_type, target_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX risk_alerts_open_report_unique ON risk_alerts (report_id) WHERE status = 'open' AND report_id IS NOT NULL;

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (gen_random_uuid(), 'governance.policy.read', 'Read governance policy', 'Read automated governance thresholds.'),
    (gen_random_uuid(), 'governance.policy.write', 'Write governance policy', 'Change automated governance thresholds.'),
    (gen_random_uuid(), 'governance.alerts.read', 'Read risk alerts', 'Read automated governance risk alerts.'),
    (gen_random_uuid(), 'governance.alerts.resolve', 'Resolve risk alerts', 'Acknowledge or dismiss risk alerts.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'governance.policy.read', 'governance.policy.write',
      'governance.alerts.read', 'governance.alerts.resolve'
  )
ON CONFLICT DO NOTHING;
