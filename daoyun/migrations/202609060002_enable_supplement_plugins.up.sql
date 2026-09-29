ALTER TABLE plugins DROP CONSTRAINT plugins_capabilities_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_capabilities_valid CHECK (
    daoyun_valid_plugin_string_set(capabilities, ARRAY[
        'content.transform', 'ui.panel', 'events.subscribe', 'core.query',
        'points.write', 'experience.write', 'entitlements.write', 'notifications.write',
        'storage.read_write', 'tasks.schedule', 'topic.supplements'
    ], 1, 16)
);
ALTER TABLE plugins DROP CONSTRAINT plugins_business_contract_consistent;
ALTER TABLE plugins ADD CONSTRAINT plugins_business_contract_consistent CHECK (
    (business_api_version IS NULL AND data_scopes = '[]'::jsonb
        AND capabilities <@ '["content.transform", "ui.panel"]'::jsonb)
    OR (business_api_version = '0.1.0' AND NOT capabilities ? 'content.transform'
        AND capabilities ?| ARRAY['events.subscribe', 'core.query', 'points.write',
            'experience.write', 'entitlements.write', 'notifications.write',
            'storage.read_write', 'tasks.schedule', 'topic.supplements'])
);
-- One installed provider owns this site-wide extension, avoiding ambiguous lifecycle controls.
CREATE UNIQUE INDEX plugins_one_topic_supplements_provider
    ON plugins ((true)) WHERE capabilities ? 'topic.supplements';
