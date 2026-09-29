DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM plugins WHERE capabilities ? 'membership.redemption') THEN
 RAISE EXCEPTION 'Uninstall the membership.redemption provider before rollback'; END IF;
 IF EXISTS(SELECT 1 FROM point_redemptions) THEN
 RAISE EXCEPTION 'Redemption history exists; restore a verified backup instead of deleting financial facts'; END IF;
END $$;
DROP TABLE point_redemptions;
DROP TABLE redemption_products;
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_key IN ('membership.redemptions.read','membership.redemptions.write'));
DELETE FROM permissions WHERE permission_key IN ('membership.redemptions.read','membership.redemptions.write');
DROP INDEX plugins_one_redemption_provider;
ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
 daoyun_valid_plugin_string_set(capabilities, ARRAY[
 'content.transform','ui.panel','events.subscribe','core.query','points.write','experience.write',
 'entitlements.write','notifications.write','storage.read_write','tasks.schedule','topic.supplements','topic.edit_review'],1,16));
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
 (business_api_version IS NULL AND data_scopes='[]'::jsonb AND capabilities <@ '["content.transform","ui.panel"]'::jsonb)
 OR (business_api_version='0.1.0' AND NOT capabilities ? 'content.transform' AND capabilities ?| ARRAY[
 'events.subscribe','core.query','points.write','experience.write','entitlements.write','notifications.write',
 'storage.read_write','tasks.schedule','topic.supplements','topic.edit_review']));
