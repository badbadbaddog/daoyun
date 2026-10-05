-- Existing objects stay in place; operators declare the provider for unmarked history.
ALTER TABLE topic_attachments ADD COLUMN storage_provider varchar(8) CHECK (storage_provider IN ('local', 's3'));
ALTER TABLE site_branding_assets ADD COLUMN storage_provider varchar(8) CHECK (storage_provider IN ('local', 's3'));
ALTER TABLE membership_medal_assets ADD COLUMN storage_provider varchar(8) CHECK (storage_provider IN ('local', 's3'));
