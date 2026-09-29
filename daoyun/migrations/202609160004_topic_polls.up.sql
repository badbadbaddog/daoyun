CREATE TABLE topic_polls (
 topic_id uuid PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
 provider_key varchar(64) NOT NULL,
 question text NOT NULL CHECK(char_length(question) BETWEEN 1 AND 200),
 ends_at timestamptz NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE topic_poll_options (
 id uuid PRIMARY KEY, topic_id uuid NOT NULL REFERENCES topic_polls(topic_id) ON DELETE CASCADE,
 position smallint NOT NULL CHECK(position BETWEEN 0 AND 9), label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 120),
 UNIQUE(topic_id,position), UNIQUE(topic_id,id)
);
CREATE TABLE topic_poll_votes (
 topic_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id), option_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(topic_id,user_id), FOREIGN KEY(topic_id,option_id) REFERENCES topic_poll_options(topic_id,id)
);
CREATE INDEX topic_poll_votes_option ON topic_poll_votes(topic_id,option_id);
ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
 daoyun_valid_plugin_string_set(capabilities, ARRAY[
 'content.transform','ui.panel','events.subscribe','core.query','points.write','experience.write',
 'entitlements.write','notifications.write','storage.read_write','tasks.schedule',
 'topic.supplements','topic.edit_review','membership.redemption','community.analytics','topic.polls'],1,16));
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
 (business_api_version IS NULL AND data_scopes='[]'::jsonb AND capabilities <@ '["content.transform","ui.panel"]'::jsonb)
 OR (business_api_version='0.1.0' AND NOT capabilities ? 'content.transform' AND capabilities ?| ARRAY[
 'events.subscribe','core.query','points.write','experience.write','entitlements.write','notifications.write',
 'storage.read_write','tasks.schedule','topic.supplements','topic.edit_review','membership.redemption','community.analytics','topic.polls']));
