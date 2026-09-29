ALTER TABLE membership_medal_rules DROP CONSTRAINT membership_medal_rules_key_valid;
ALTER TABLE membership_medals DROP CONSTRAINT membership_medals_medal_key_fkey;
ALTER TABLE membership_medal_rules ALTER COLUMN medal_key TYPE varchar(64);
ALTER TABLE membership_medals ALTER COLUMN medal_key TYPE varchar(64);
ALTER TABLE membership_medals ADD CONSTRAINT membership_medals_medal_key_fkey
    FOREIGN KEY (medal_key) REFERENCES membership_medal_rules(medal_key);
ALTER TABLE membership_medal_rules
    ADD COLUMN display_name varchar(80),
    ADD COLUMN asset_key varchar(9),
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    ADD COLUMN deleted_at timestamptz;
UPDATE membership_medal_rules SET display_name = '勋章 ' || right(medal_key, 2), asset_key = medal_key;
ALTER TABLE membership_medal_rules
    ALTER COLUMN display_name SET NOT NULL,
    ALTER COLUMN asset_key SET NOT NULL,
    ADD CONSTRAINT membership_medal_rules_key_valid CHECK (medal_key ~ '^[a-z][a-z0-9_]{2,63}$'),
    ADD CONSTRAINT membership_medal_rules_name_valid CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
    ADD CONSTRAINT membership_medal_rules_asset_valid CHECK (asset_key ~ '^medal_(0[1-9]|1[0-7])$');
