CREATE TABLE membership_accounts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    points_balance bigint NOT NULL DEFAULT 0,
    lifetime_points bigint NOT NULL DEFAULT 0,
    level_key varchar(3) NOT NULL DEFAULT 'L1',
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT membership_accounts_points_balance_non_negative CHECK (points_balance >= 0),
    CONSTRAINT membership_accounts_lifetime_points_non_negative CHECK (lifetime_points >= 0),
    CONSTRAINT membership_accounts_level_valid CHECK (level_key IN (
        'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10',
        'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20'
    ))
);

CREATE TABLE point_ledger_entries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount bigint NOT NULL,
    reason varchar(64) NOT NULL,
    idempotency_key varchar(128),
    balance_after bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT point_ledger_entries_amount_non_zero CHECK (amount <> 0),
    CONSTRAINT point_ledger_entries_balance_non_negative CHECK (balance_after >= 0),
    CONSTRAINT point_ledger_entries_reason_valid CHECK (reason ~ '^[a-z][a-z0-9._-]{1,63}$'),
    CONSTRAINT point_ledger_entries_idempotency_key_valid CHECK (
        idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'
    ),
    CONSTRAINT point_ledger_entries_user_key_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX point_ledger_entries_user_created_index
    ON point_ledger_entries (user_id, created_at DESC, id DESC);

INSERT INTO membership_accounts (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
