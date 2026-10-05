-- Expand only: preserve IDs, provider keys, history, components and disabled state.
ALTER TABLE plugins ADD COLUMN execution varchar(16) NOT NULL DEFAULT 'wasm';
ALTER TABLE plugins ADD CONSTRAINT plugins_execution_valid CHECK (execution IN ('wasm','native'));
ALTER TABLE plugins ADD CONSTRAINT plugins_native_contract_valid CHECK (execution='wasm' OR (key IN ('official_polls', 'official_points_redemption', 'official_community_analytics', 'official_topic_supplements', 'official_topic_edit_review') AND manifest_schema_version=1 AND business_api_version IS NOT DISTINCT FROM '0.1.0' AND data_scopes='[]'::jsonb AND event_subscriptions='[]'::jsonb AND capabilities IN (jsonb_build_array(CASE key WHEN 'official_polls' THEN 'topic.polls'
            WHEN 'official_points_redemption' THEN 'membership.redemption'
            WHEN 'official_community_analytics' THEN 'community.analytics'
            WHEN 'official_topic_supplements' THEN 'topic.supplements'
            WHEN 'official_topic_edit_review' THEN 'topic.edit_review' END),jsonb_build_array(CASE key WHEN 'official_polls' THEN 'topic.polls'
            WHEN 'official_points_redemption' THEN 'membership.redemption'
            WHEN 'official_community_analytics' THEN 'community.analytics'
            WHEN 'official_topic_supplements' THEN 'topic.supplements'
            WHEN 'official_topic_edit_review' THEN 'topic.edit_review' END,'ui.panel'))));
ALTER TABLE plugins DROP CONSTRAINT plugins_component_size_valid;
ALTER TABLE plugins ADD CONSTRAINT plugins_component_size_valid CHECK (octet_length(component_bytes) BETWEEN CASE WHEN execution='native' THEN 0 ELSE 1 END AND 8388608);
DO $$
DECLARE provider record;
BEGIN
    FOR provider IN SELECT id FROM plugins WHERE key IN ('official_polls', 'official_points_redemption', 'official_community_analytics', 'official_topic_supplements', 'official_topic_edit_review') AND manifest_schema_version=1 AND business_api_version IS NOT DISTINCT FROM '0.1.0' AND data_scopes='[]'::jsonb AND event_subscriptions='[]'::jsonb AND capabilities = jsonb_build_array(CASE key WHEN 'official_polls' THEN 'topic.polls'
            WHEN 'official_points_redemption' THEN 'membership.redemption'
            WHEN 'official_community_analytics' THEN 'community.analytics'
            WHEN 'official_topic_supplements' THEN 'topic.supplements'
            WHEN 'official_topic_edit_review' THEN 'topic.edit_review' END,'ui.panel') FOR UPDATE LOOP
        IF EXISTS(SELECT 1 FROM plugin_execution_leases WHERE plugin_id=provider.id AND locked_until>CURRENT_TIMESTAMP)
           OR EXISTS(SELECT 1 FROM plugin_command_receipts WHERE plugin_id=provider.id AND status='pending' AND locked_until>CURRENT_TIMESTAMP) THEN
            RAISE EXCEPTION 'builtin conversion requires drained plugin execution';
        END IF;
        UPDATE plugins SET execution='native', revision=revision+1 WHERE id=provider.id;
    END LOOP;
END $$;
