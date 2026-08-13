CREATE TABLE membership_level_rules (
    level_key varchar(3) PRIMARY KEY,
    level_number smallint NOT NULL UNIQUE,
    required_lifetime_points bigint NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT FALSE,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT membership_level_rules_number_valid CHECK (level_number BETWEEN 1 AND 20),
    CONSTRAINT membership_level_rules_key_matches_number CHECK (
        level_key = 'L' || level_number::text
    ),
    CONSTRAINT membership_level_rules_threshold_valid CHECK (
        (level_number = 1 AND enabled AND required_lifetime_points = 0)
        OR (level_number > 1 AND (NOT enabled OR required_lifetime_points > 0))
    )
);

INSERT INTO membership_level_rules (
    level_key,
    level_number,
    required_lifetime_points,
    enabled
)
SELECT 'L' || level_number::text, level_number, 0, level_number = 1
FROM generate_series(1, 20) AS level_number;

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (gen_random_uuid(), 'membership.rules.read', 'Read membership rules', 'Read configured membership level thresholds.'),
    (gen_random_uuid(), 'membership.rules.write', 'Write membership rules', 'Change membership level thresholds.'),
    (gen_random_uuid(), 'membership.points.grant', 'Grant membership points', 'Grant points to membership accounts.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'membership.rules.read',
      'membership.rules.write',
      'membership.points.grant'
  )
ON CONFLICT DO NOTHING;
