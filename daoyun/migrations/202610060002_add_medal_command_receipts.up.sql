CREATE TABLE membership_medal_states (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO membership_medal_states (user_id, revision)
SELECT DISTINCT user_id, 1 FROM membership_medals;
CREATE TABLE membership_medal_command_receipts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key varchar(64) NOT NULL,
    operation varchar(8) NOT NULL CHECK (operation IN ('grant', 'revoke')),
    medal_key varchar(64) NOT NULL,
    medal_display_name text NOT NULL,
    medal_asset_key text NOT NULL,
    medal_granted_at timestamptz,
    reason text NOT NULL,
    actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
    revision bigint NOT NULL CHECK (revision >= expected_revision),
    affected boolean NOT NULL,
    owned_after boolean NOT NULL,
    audit_id uuid REFERENCES admin_audit_log(id) ON DELETE RESTRICT,
    operation_request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key),
    CHECK (affected = (audit_id IS NOT NULL))
);
