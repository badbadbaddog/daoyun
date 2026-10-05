-- Verify historical/new object locations before rolling back to a single-provider binary.
ALTER TABLE membership_medal_assets DROP COLUMN storage_provider;
ALTER TABLE site_branding_assets DROP COLUMN storage_provider;
ALTER TABLE topic_attachments DROP COLUMN storage_provider;
