DROP TABLE content_edit_reviews;
DROP TABLE edit_review_policies;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM plugins WHERE capabilities ? 'topic.edit_review') THEN
        RAISE EXCEPTION 'Uninstall the topic.edit_review provider before rollback';
    END IF;
END $$;
DROP INDEX plugins_one_topic_edit_review_provider;

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
