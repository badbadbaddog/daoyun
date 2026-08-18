CREATE TABLE membership_levels (
    id uuid PRIMARY KEY,
    internal_key varchar(64) NOT NULL UNIQUE,
    level_order integer NOT NULL UNIQUE,
    display_name varchar(80) NOT NULL,
    required_experience bigint NOT NULL,
    icon_asset_id uuid,
    color varchar(7),
    description text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT membership_levels_internal_key_check
        CHECK (internal_key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT membership_levels_order_check CHECK (level_order > 0),
    CONSTRAINT membership_levels_display_name_check
        CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT membership_levels_required_experience_check CHECK (required_experience >= 0),
    CONSTRAINT membership_levels_color_check
        CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT membership_levels_description_check CHECK (char_length(description) <= 500),
    CONSTRAINT membership_levels_status_check
        CHECK (status IN ('draft', 'published', 'disabled', 'archived')),
    CONSTRAINT membership_levels_publication_check
        CHECK (
            (status = 'draft' AND published_at IS NULL)
            OR (status IN ('published', 'disabled', 'archived') AND published_at IS NOT NULL)
        ),
    CONSTRAINT membership_levels_revision_check CHECK (revision > 0)
);

WITH stable_ids(level_order, id) AS (
    VALUES
        (1,  '01a00170-6154-754f-b4a5-b62c7e8b018b'::uuid),
        (2,  '01a00170-6155-7827-960e-ed4a205751f9'::uuid),
        (3,  '01a00170-6156-7120-b43a-18860ee55955'::uuid),
        (4,  '01a00170-6157-7817-84d2-1cf8302838c7'::uuid),
        (5,  '01a00170-6158-7686-a018-43ee5b9048f5'::uuid),
        (6,  '01a00170-6159-7a91-ac69-ff4cb8cdd224'::uuid),
        (7,  '01a00170-615a-75e0-931a-278fdc961ccc'::uuid),
        (8,  '01a00170-615b-7c70-84ce-9c28da6b9f80'::uuid),
        (9,  '01a00170-615c-7930-979e-bb7eb153889d'::uuid),
        (10, '01a00170-615d-7fa9-b49d-a665ce3b78cb'::uuid),
        (11, '01a00170-615e-79b5-82d0-23438a98cd30'::uuid),
        (12, '01a00170-615f-7b24-b46e-4e8eb32b9984'::uuid),
        (13, '01a00170-6160-778b-92da-3ff851547eaa'::uuid),
        (14, '01a00170-6161-7556-a15a-4577e86836f7'::uuid),
        (15, '01a00170-6162-74be-b2a4-6b4b89776b3f'::uuid),
        (16, '01a00170-6163-7a35-a9a2-6bf401246175'::uuid),
        (17, '01a00170-6164-7328-ad2f-2cf2697bafa0'::uuid),
        (18, '01a00170-6165-7ad8-9bcb-4c992f4b1bad'::uuid),
        (19, '01a00170-6166-7c8e-b0c9-1db74f0917ce'::uuid),
        (20, '01a00170-6167-7844-90de-2bf4ef0b9d71'::uuid)
)
INSERT INTO membership_levels (
    id,
    internal_key,
    level_order,
    display_name,
    required_experience,
    status,
    published_at,
    created_at,
    updated_at
)
SELECT
    stable_ids.id,
    rules.level_key,
    rules.level_number,
    rules.level_display_name,
    rules.required_lifetime_points,
    CASE WHEN rules.enabled THEN 'published' ELSE 'draft' END,
    CASE WHEN rules.enabled THEN rules.updated_at ELSE NULL END,
    rules.updated_at,
    rules.updated_at
FROM membership_level_rules AS rules
JOIN stable_ids ON stable_ids.level_order = rules.level_number
ORDER BY rules.level_number;

CREATE INDEX membership_levels_active_order_idx
    ON membership_levels (level_order)
    WHERE status = 'published';

CREATE INDEX membership_levels_active_experience_idx
    ON membership_levels (required_experience DESC, level_order DESC)
    WHERE status = 'published';

CREATE FUNCTION validate_published_membership_level_thresholds()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    first_threshold bigint;
BEGIN
    SELECT required_experience
    INTO first_threshold
    FROM membership_levels
    WHERE status = 'published'
    ORDER BY level_order ASC
    LIMIT 1;

    IF first_threshold IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'first published membership level must require zero experience'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT
                required_experience,
                lag(required_experience) OVER (ORDER BY level_order) AS previous_threshold
            FROM membership_levels
            WHERE status = 'published'
        ) AS ordered_levels
        WHERE previous_threshold IS NOT NULL
          AND required_experience <= previous_threshold
    ) THEN
        RAISE EXCEPTION 'published membership level thresholds must be strictly increasing'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER membership_levels_validate_published_thresholds
AFTER INSERT OR UPDATE OR DELETE ON membership_levels
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_published_membership_level_thresholds();

CREATE TABLE experience_accounts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    experience bigint NOT NULL DEFAULT 0,
    current_level_id uuid NOT NULL REFERENCES membership_levels(id) ON DELETE RESTRICT,
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experience_accounts_experience_check CHECK (experience >= 0),
    CONSTRAINT experience_accounts_revision_check CHECK (revision > 0)
);

INSERT INTO experience_accounts (user_id, experience, current_level_id, revision, updated_at)
SELECT
    users.id,
    COALESCE(points.lifetime_points, 0),
    COALESCE(current_level.id, first_level.id),
    COALESCE(points.revision, 1),
    COALESCE(points.updated_at, users.updated_at)
FROM users
LEFT JOIN membership_accounts AS points ON points.user_id = users.id
LEFT JOIN membership_levels AS current_level ON current_level.internal_key = points.level_key
CROSS JOIN membership_levels AS first_level
WHERE first_level.level_order = 1;

CREATE FUNCTION initialize_experience_account_for_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO experience_accounts (user_id, current_level_id)
    SELECT NEW.id, level.id
    FROM membership_levels AS level
    WHERE level.status = 'published'
    ORDER BY level.level_order ASC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'published membership level is required';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER users_initialize_experience_account
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION initialize_experience_account_for_user();

CREATE TABLE experience_ledger_entries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount bigint NOT NULL,
    reason varchar(80) NOT NULL,
    source_resource_id uuid,
    idempotency_key varchar(128) NOT NULL,
    reversal_of uuid REFERENCES experience_ledger_entries(id) ON DELETE RESTRICT,
    balance_after bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experience_ledger_entries_amount_check CHECK (amount <> 0),
    CONSTRAINT experience_ledger_entries_reason_check
        CHECK (reason ~ '^[a-z][a-z0-9_.]{2,79}$'),
    CONSTRAINT experience_ledger_entries_idempotency_key_check
        CHECK (idempotency_key ~ '^[!-~]{1,128}$'),
    CONSTRAINT experience_ledger_entries_balance_check CHECK (balance_after >= 0),
    CONSTRAINT experience_ledger_entries_user_idempotency_key
        UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX experience_ledger_entries_reversal_once_idx
    ON experience_ledger_entries (reversal_of)
    WHERE reversal_of IS NOT NULL;

CREATE INDEX experience_ledger_entries_user_created_idx
    ON experience_ledger_entries (user_id, created_at DESC, id DESC);

INSERT INTO experience_ledger_entries (
    id,
    user_id,
    amount,
    reason,
    idempotency_key,
    balance_after,
    created_at
)
SELECT
    account.user_id,
    account.user_id,
    account.experience,
    'schema.membership_v2_backfill',
    'schema.membership_v2_backfill',
    account.experience,
    account.updated_at
FROM experience_accounts AS account
WHERE account.experience > 0;
