DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM plugins WHERE capabilities ? 'community.analytics') THEN
  RAISE EXCEPTION 'Uninstall analytics providers before rolling back';
 END IF;
END $$;
DROP TRIGGER analytics_topic_published ON topics;
DROP TRIGGER analytics_reply_created ON posts;
DROP FUNCTION daoyun_capture_analytics_content();
DROP TABLE analytics_content_events,analytics_activity,analytics_gaps,analytics_collection;
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_key='community.analytics.read');
DELETE FROM permissions WHERE permission_key='community.analytics.read';
ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
 daoyun_valid_plugin_string_set(capabilities, ARRAY[
 'content.transform','ui.panel','events.subscribe','core.query','points.write','experience.write',
 'entitlements.write','notifications.write','storage.read_write','tasks.schedule',
 'topic.supplements','topic.edit_review','membership.redemption'],1,16));
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
 (business_api_version IS NULL AND data_scopes='[]'::jsonb AND capabilities <@ '["content.transform","ui.panel"]'::jsonb)
 OR (business_api_version='0.1.0' AND NOT capabilities ? 'content.transform' AND capabilities ?| ARRAY[
 'events.subscribe','core.query','points.write','experience.write','entitlements.write','notifications.write',
 'storage.read_write','tasks.schedule','topic.supplements','topic.edit_review','membership.redemption']));
