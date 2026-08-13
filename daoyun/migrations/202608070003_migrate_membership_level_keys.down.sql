BEGIN;

ALTER TABLE membership_accounts
    DROP CONSTRAINT membership_accounts_level_valid;
ALTER TABLE membership_level_rules
    DROP CONSTRAINT membership_level_rules_key_matches_number,
    DROP CONSTRAINT membership_level_rules_display_name_valid,
    DROP CONSTRAINT membership_level_rules_threshold_valid;

UPDATE membership_accounts
SET level_key = 'L' || substring(level_key FROM 4)
WHERE level_key ~ '^lv_([1-9]|1[0-9]|20)$';

UPDATE membership_level_rules
SET level_key = 'L' || level_number::text
WHERE level_key ~ '^lv_([1-9]|1[0-9]|20)$';

ALTER TABLE membership_accounts
    ALTER COLUMN level_key TYPE varchar(3),
    ALTER COLUMN level_key SET DEFAULT 'L1',
    ADD CONSTRAINT membership_accounts_level_valid CHECK (level_key IN (
        'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10',
        'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20'
    ));

ALTER TABLE membership_level_rules
    ALTER COLUMN level_key TYPE varchar(3),
    DROP COLUMN level_display_name,
    ADD CONSTRAINT membership_level_rules_key_matches_number CHECK (
        level_key = 'L' || level_number::text
    ),
    ADD CONSTRAINT membership_level_rules_threshold_valid CHECK (
        (level_number = 1 AND enabled AND required_lifetime_points = 0)
        OR (level_number > 1 AND (NOT enabled OR required_lifetime_points > 0))
    );

COMMIT;
