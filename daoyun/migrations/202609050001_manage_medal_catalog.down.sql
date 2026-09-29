-- Refuse a rollback that would destroy custom medals or deleted catalog state.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM membership_medal_rules WHERE medal_key !~ '^medal_(0[1-9]|1[0-7])$' OR deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Custom medal catalog data must be preserved; rollback is unavailable';
    END IF;
END $$;
ALTER TABLE membership_medals DROP CONSTRAINT membership_medals_medal_key_fkey;
ALTER TABLE membership_medal_rules DROP CONSTRAINT membership_medal_rules_key_valid;
ALTER TABLE membership_medal_rules ALTER COLUMN medal_key TYPE varchar(9);
ALTER TABLE membership_medals ALTER COLUMN medal_key TYPE varchar(9);
ALTER TABLE membership_medals ADD CONSTRAINT membership_medals_medal_key_fkey FOREIGN KEY (medal_key) REFERENCES membership_medal_rules(medal_key);
ALTER TABLE membership_medal_rules ADD CONSTRAINT membership_medal_rules_key_valid CHECK (medal_key ~ '^medal_(0[1-9]|1[0-7])$');
ALTER TABLE membership_medal_rules DROP COLUMN display_name, DROP COLUMN asset_key, DROP COLUMN revision, DROP COLUMN deleted_at;
