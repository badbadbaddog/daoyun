CREATE TABLE analytics_collection (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 activity_confirmed_through date NOT NULL DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1)
);
INSERT INTO analytics_collection(id) VALUES(true);
CREATE TABLE analytics_activity (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day date NOT NULL,
 PRIMARY KEY(day,user_id)
);
CREATE TABLE analytics_gaps (
 day date NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('activity','content')),
 PRIMARY KEY(day,kind)
);
CREATE TABLE analytics_content_events (
 id uuid NOT NULL,
 kind varchar(8) NOT NULL CHECK(kind IN ('topic','reply')),
 board_id uuid NOT NULL,
 author_id uuid NOT NULL,
 happened_at timestamptz NOT NULL,
 PRIMARY KEY(kind,id)
);
CREATE INDEX analytics_content_events_time ON analytics_content_events(happened_at,board_id);
-- A publication fact is immutable even when the content is later hidden or removed.
CREATE FUNCTION daoyun_capture_analytics_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='topics' THEN
  IF NEW.status='published' AND NEW.moderation_status='approved' THEN
   INSERT INTO analytics_content_events(id,kind,board_id,author_id,happened_at)
   VALUES(NEW.id,'topic',NEW.board_id,NEW.author_id,COALESCE(NEW.published_at,CURRENT_TIMESTAMP))
   ON CONFLICT DO NOTHING;
  END IF;
 ELSIF NEW.kind='reply' THEN
  INSERT INTO analytics_content_events(id,kind,board_id,author_id,happened_at)
  SELECT NEW.id,'reply',board_id,NEW.author_id,NEW.created_at FROM topics WHERE id=NEW.topic_id
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Analytics failures must not reject publication; record an incomplete UTC day.
 BEGIN
  INSERT INTO analytics_gaps(day,kind) VALUES((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,'content') ON CONFLICT DO NOTHING;
 EXCEPTION WHEN OTHERS THEN NULL;
 END;
 RETURN NEW;
END $$;
CREATE TRIGGER analytics_topic_published AFTER INSERT OR UPDATE OF status,published_at ON topics
 FOR EACH ROW EXECUTE FUNCTION daoyun_capture_analytics_content();
CREATE TRIGGER analytics_reply_created AFTER INSERT ON posts
 FOR EACH ROW EXECUTE FUNCTION daoyun_capture_analytics_content();
INSERT INTO permissions(id,permission_key,name,description) VALUES
 (daoyun_uuid_v7(),'community.analytics.read','Read community analytics','Read aggregate community analytics without user details.');
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.key='super_admin' AND p.permission_key='community.analytics.read' ON CONFLICT DO NOTHING;

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
