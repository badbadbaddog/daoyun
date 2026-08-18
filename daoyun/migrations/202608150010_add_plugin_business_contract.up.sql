CREATE OR REPLACE FUNCTION daoyun_valid_plugin_string_set(
    candidate jsonb,
    allowed_values text[],
    minimum_items integer,
    maximum_items integer
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    item jsonb;
    item_text text;
    seen text[] := ARRAY[]::text[];
BEGIN
    IF jsonb_typeof(candidate) <> 'array'
       OR jsonb_array_length(candidate) NOT BETWEEN minimum_items AND maximum_items
    THEN
        RETURN FALSE;
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(candidate)
    LOOP
        IF jsonb_typeof(item) <> 'string' THEN
            RETURN FALSE;
        END IF;
        item_text := item #>> '{}';
        IF NOT (item_text = ANY(allowed_values)) OR item_text = ANY(seen) THEN
            RETURN FALSE;
        END IF;
        seen := array_append(seen, item_text);
    END LOOP;
    RETURN TRUE;
END;
$$;

ALTER TABLE plugins
    DROP CONSTRAINT plugins_capabilities_valid;

ALTER TABLE plugins
    ADD COLUMN manifest_schema_version smallint NOT NULL DEFAULT 1,
    ADD COLUMN business_api_version varchar(16),
    ADD COLUMN data_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT plugins_manifest_schema_version_valid
        CHECK (manifest_schema_version = 1),
    ADD CONSTRAINT plugins_business_api_version_valid
        CHECK (business_api_version IS NULL OR business_api_version = '0.1.0'),
    ADD CONSTRAINT plugins_capabilities_valid CHECK (
        daoyun_valid_plugin_string_set(
            capabilities,
            ARRAY[
                'content.transform', 'ui.panel', 'events.subscribe', 'core.query',
                'points.write', 'experience.write', 'entitlements.write',
                'notifications.write', 'storage.read_write', 'tasks.schedule'
            ],
            1,
            16
        )
    ),
    ADD CONSTRAINT plugins_data_scopes_valid CHECK (
        daoyun_valid_plugin_string_set(
            data_scopes,
            ARRAY[
                'site.read', 'actor.read', 'users.read.basic',
                'users.read.membership', 'users.targeted', 'boards.read'
            ],
            0,
            8
        )
    ),
    ADD CONSTRAINT plugins_business_contract_consistent CHECK (
        (
            business_api_version IS NULL
            AND data_scopes = '[]'::jsonb
            AND capabilities <@ '["content.transform", "ui.panel"]'::jsonb
        )
        OR (
            business_api_version = '0.1.0'
            AND NOT capabilities ? 'content.transform'
            AND capabilities ?| ARRAY[
                'events.subscribe', 'core.query', 'points.write', 'experience.write',
                'entitlements.write', 'notifications.write',
                'storage.read_write', 'tasks.schedule'
            ]
        )
    ),
    ADD CONSTRAINT plugins_targeted_write_scope_required CHECK (
        NOT (
            capabilities ?| ARRAY[
                'points.write', 'experience.write',
                'entitlements.write', 'notifications.write'
            ]
        )
        OR data_scopes ? 'users.targeted'
    );
