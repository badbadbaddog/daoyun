DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM plugins WHERE business_api_version IS NOT NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55006',
            MESSAGE = 'cannot roll back plugin business contract while business plugins are installed';
    END IF;
END;
$$;

ALTER TABLE plugins
    DROP CONSTRAINT plugins_targeted_write_scope_required,
    DROP CONSTRAINT plugins_business_contract_consistent,
    DROP CONSTRAINT plugins_data_scopes_valid,
    DROP CONSTRAINT plugins_capabilities_valid,
    DROP CONSTRAINT plugins_business_api_version_valid,
    DROP CONSTRAINT plugins_manifest_schema_version_valid,
    DROP COLUMN data_scopes,
    DROP COLUMN business_api_version,
    DROP COLUMN manifest_schema_version;

ALTER TABLE plugins
    ADD CONSTRAINT plugins_capabilities_valid CHECK (
        capabilities = '["content.transform"]'::jsonb
        OR capabilities = '["ui.panel"]'::jsonb
        OR capabilities = '["content.transform", "ui.panel"]'::jsonb
    );

DROP FUNCTION daoyun_valid_plugin_string_set(jsonb, text[], integer, integer);
