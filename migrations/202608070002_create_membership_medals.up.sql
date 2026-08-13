CREATE TABLE membership_medal_rules (
    medal_key varchar(9) PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT FALSE,
    required_lifetime_points bigint,
    updated_by uuid REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT membership_medal_rules_key_valid CHECK (medal_key ~ '^medal_(0[1-9]|1[0-7])$'),
    CONSTRAINT membership_medal_rules_threshold_valid CHECK (
        required_lifetime_points IS NULL OR required_lifetime_points >= 0
    )
);

INSERT INTO membership_medal_rules (medal_key)
SELECT 'medal_' || lpad(number::text, 2, '0')
FROM generate_series(1, 17) AS number;

CREATE TABLE membership_medals (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medal_key varchar(9) NOT NULL REFERENCES membership_medal_rules(medal_key),
    granted_by uuid REFERENCES users(id),
    reason varchar(64) NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, medal_key),
    CONSTRAINT membership_medals_reason_valid CHECK (reason ~ '^[a-z][a-z0-9._-]{1,63}$')
);

CREATE INDEX membership_medals_user_granted_index
    ON membership_medals (user_id, granted_at DESC, medal_key);

INSERT INTO permissions (id, permission_key, name, description)
VALUES
    (gen_random_uuid(), 'membership.medals.read', 'Read membership medals', 'Read medal ownership and operating rules.'),
    (gen_random_uuid(), 'membership.medals.grant', 'Grant membership medals', 'Grant or revoke medals for users.'),
    (gen_random_uuid(), 'membership.medals.rules.write', 'Write membership medal rules', 'Change automatic medal award rules.')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.key = 'super_admin'
  AND permission.permission_key IN (
      'membership.medals.read',
      'membership.medals.grant',
      'membership.medals.rules.write'
  )
ON CONFLICT DO NOTHING;
