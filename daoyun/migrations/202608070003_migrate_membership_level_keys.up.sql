BEGIN;

-- Convert the pre-release L1..L20 keys before tightening the runtime contract.
ALTER TABLE membership_accounts
    DROP CONSTRAINT membership_accounts_level_valid;
ALTER TABLE membership_level_rules
    DROP CONSTRAINT membership_level_rules_key_matches_number,
    DROP CONSTRAINT membership_level_rules_threshold_valid;

ALTER TABLE membership_accounts
    ALTER COLUMN level_key TYPE varchar(5),
    ALTER COLUMN level_key SET DEFAULT 'lv_1';
ALTER TABLE membership_level_rules
    ALTER COLUMN level_key TYPE varchar(5),
    ADD COLUMN level_display_name varchar(80);

UPDATE membership_level_rules
SET level_key = 'lv_' || level_number::text,
    level_display_name = 'Lv' || level_number::text;

UPDATE membership_accounts
SET level_key = 'lv_' || substring(level_key FROM 2)
WHERE level_key ~ '^L([1-9]|1[0-9]|20)$';

-- The first six levels are the initial published set. Existing positive thresholds
-- are retained where possible; fresh installations receive deterministic defaults.
UPDATE membership_level_rules
SET required_lifetime_points = CASE level_number
    WHEN 1 THEN 0
    WHEN 2 THEN GREATEST(required_lifetime_points, 100)
    WHEN 3 THEN GREATEST(required_lifetime_points, 500)
    WHEN 4 THEN GREATEST(required_lifetime_points, 1500)
    WHEN 5 THEN GREATEST(required_lifetime_points, 4000)
    WHEN 6 THEN GREATEST(required_lifetime_points, 10000)
    ELSE required_lifetime_points
END,
enabled = level_number BETWEEN 1 AND 6;

-- Preserve custom thresholds while repairing any old non-monotonic configuration.
DO $$
DECLARE
    current_rule record;
    previous_threshold bigint := -1;
BEGIN
    FOR current_rule IN
        SELECT level_number, required_lifetime_points
        FROM membership_level_rules
        WHERE enabled
        ORDER BY level_number
        FOR UPDATE
    LOOP
        IF current_rule.required_lifetime_points <= previous_threshold THEN
            UPDATE membership_level_rules
            SET required_lifetime_points = previous_threshold + 1
            WHERE level_number = current_rule.level_number;
            previous_threshold := previous_threshold + 1;
        ELSE
            previous_threshold := current_rule.required_lifetime_points;
        END IF;
    END LOOP;
END
$$;

ALTER TABLE membership_level_rules
    ALTER COLUMN level_display_name SET NOT NULL;

ALTER TABLE membership_accounts
    ADD CONSTRAINT membership_accounts_level_valid CHECK (
        level_key ~ '^lv_([1-9]|1[0-9]|20)$'
    );
ALTER TABLE membership_level_rules
    ADD CONSTRAINT membership_level_rules_key_matches_number CHECK (
        level_key = 'lv_' || level_number::text
    ),
    ADD CONSTRAINT membership_level_rules_display_name_valid CHECK (
        char_length(level_display_name) BETWEEN 1 AND 80
        AND level_display_name !~ '[[:cntrl:]]'
    ),
    ADD CONSTRAINT membership_level_rules_threshold_valid CHECK (
        (level_number = 1 AND enabled AND required_lifetime_points = 0)
        OR (level_number > 1 AND (NOT enabled OR required_lifetime_points > 0))
    );

COMMIT;
