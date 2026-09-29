DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM membership_medal_rules WHERE uploaded_asset_key IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove uploaded medal assets while medals reference them';
    END IF;
END $$;
ALTER TABLE membership_medal_rules DROP COLUMN uploaded_asset_key;
ALTER TABLE membership_medal_rules DROP CONSTRAINT membership_medal_rules_asset_valid;
ALTER TABLE membership_medal_rules ALTER COLUMN asset_key TYPE varchar(9);
ALTER TABLE membership_medal_rules ADD CONSTRAINT membership_medal_rules_asset_valid CHECK (asset_key ~ '^medal_(0[1-9]|1[0-7])$');
DROP TABLE membership_medal_assets;
