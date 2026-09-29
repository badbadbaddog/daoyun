CREATE TABLE membership_medal_assets (
    asset_key varchar(71) PRIMARY KEY CHECK (asset_key ~ '^upload_[a-f0-9]{64}$'),
    storage_key text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE membership_medal_rules DROP CONSTRAINT membership_medal_rules_asset_valid;
ALTER TABLE membership_medal_rules ALTER COLUMN asset_key TYPE varchar(71);
ALTER TABLE membership_medal_rules
    ADD CONSTRAINT membership_medal_rules_asset_valid CHECK (asset_key ~ '^(medal_(0[1-9]|1[0-7])|upload_[a-f0-9]{64})$'),
    ADD COLUMN uploaded_asset_key varchar(71) GENERATED ALWAYS AS (CASE WHEN asset_key LIKE 'upload_%' THEN asset_key END) STORED REFERENCES membership_medal_assets(asset_key);
