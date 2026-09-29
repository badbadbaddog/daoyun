DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM topic_poll_votes) OR EXISTS(SELECT 1 FROM plugins WHERE capabilities ? 'topic.polls') THEN RAISE EXCEPTION 'Cannot roll back retained votes or installed poll providers'; END IF;
END $$;
DROP TABLE topic_poll_votes;
DROP TABLE topic_poll_options;
DROP TABLE topic_polls;
ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
 daoyun_valid_plugin_string_set(capabilities, ARRAY[
 'content.transform','ui.panel','events.subscribe','core.query','points.write','experience.write',
 'entitlements.write','notifications.write','storage.read_write','tasks.schedule',
 'topic.supplements','topic.edit_review','membership.redemption','community.analytics'],1,16));
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
 (business_api_version IS NULL AND data_scopes='[]'::jsonb AND capabilities <@ '["content.transform","ui.panel"]'::jsonb)
 OR (business_api_version='0.1.0' AND NOT capabilities ? 'content.transform' AND capabilities ?| ARRAY[
 'events.subscribe','core.query','points.write','experience.write','entitlements.write','notifications.write',
 'storage.read_write','tasks.schedule','topic.supplements','topic.edit_review','membership.redemption','community.analytics']));
