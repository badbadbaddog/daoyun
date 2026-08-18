ALTER TABLE plugins
    ADD COLUMN event_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT plugins_event_subscriptions_valid CHECK (
        daoyun_valid_plugin_string_set(
            event_subscriptions,
            ARRAY[
                'user.created', 'topic.published', 'reply.created',
                'points.changed', 'experience.changed', 'entitlement.changed'
            ],
            0,
            6
        )
    ),
    ADD CONSTRAINT plugins_event_subscriptions_capability_required CHECK (
        event_subscriptions = '[]'::jsonb OR capabilities ? 'events.subscribe'
    );

CREATE TABLE plugin_runtime_quotas (
    plugin_id uuid PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
    storage_bytes_limit bigint NOT NULL DEFAULT 1048576,
    pending_task_limit integer NOT NULL DEFAULT 100,
    command_daily_limit integer NOT NULL DEFAULT 1000,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugin_runtime_quotas_limits_valid CHECK (
        storage_bytes_limit BETWEEN 0 AND 1099511627776
        AND pending_task_limit BETWEEN 0 AND 10000
        AND command_daily_limit BETWEEN 0 AND 1000000
    ),
    CONSTRAINT plugin_runtime_quotas_revision_positive CHECK (revision > 0),
    CONSTRAINT plugin_runtime_quotas_updated_after_created CHECK (updated_at >= created_at)
);

INSERT INTO plugin_runtime_quotas (plugin_id)
SELECT id FROM plugins
ON CONFLICT (plugin_id) DO NOTHING;

CREATE FUNCTION daoyun_seed_plugin_runtime_quotas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO plugin_runtime_quotas (plugin_id)
    VALUES (NEW.id)
    ON CONFLICT (plugin_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plugins_seed_runtime_quotas
AFTER INSERT ON plugins
FOR EACH ROW EXECUTE FUNCTION daoyun_seed_plugin_runtime_quotas();

CREATE TABLE plugin_command_usage (
    plugin_id uuid NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    window_start timestamptz NOT NULL,
    used integer NOT NULL DEFAULT 0,
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plugin_id, window_start),
    CONSTRAINT plugin_command_usage_window_valid CHECK (
        window_start = date_trunc('day', window_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ),
    CONSTRAINT plugin_command_usage_used_valid CHECK (used BETWEEN 0 AND 1000000),
    CONSTRAINT plugin_command_usage_revision_positive CHECK (revision > 0)
);

CREATE TABLE plugin_command_receipts (
    plugin_key varchar(64) NOT NULL,
    plugin_id uuid REFERENCES plugins(id) ON DELETE SET NULL,
    idempotency_key varchar(160) NOT NULL,
    command_kind varchar(40) NOT NULL,
    subject_id uuid NOT NULL,
    payload jsonb NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    execution_token uuid,
    locked_until timestamptz,
    resource_id uuid,
    result_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plugin_key, idempotency_key),
    CONSTRAINT plugin_command_receipts_plugin_key_valid CHECK (
        plugin_key ~ '^[a-z][a-z0-9_]{2,63}$'
    ),
    CONSTRAINT plugin_command_receipts_key_valid CHECK (
        char_length(idempotency_key) BETWEEN 1 AND 160
        AND idempotency_key !~ '[[:cntrl:]]'
    ),
    CONSTRAINT plugin_command_receipts_kind_valid CHECK (
        command_kind IN (
            'points.append', 'experience.append', 'entitlement.grant',
            'entitlement.revoke', 'notification.send'
        )
    ),
    CONSTRAINT plugin_command_receipts_payload_valid CHECK (
        payload <> 'null'::jsonb AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT plugin_command_receipts_status_valid CHECK (
        status IN ('pending', 'completed')
    ),
    CONSTRAINT plugin_command_receipts_state_consistent CHECK (
        (status = 'pending' AND execution_token IS NOT NULL AND locked_until IS NOT NULL
            AND resource_id IS NULL AND result_payload IS NULL)
        OR (status = 'completed' AND execution_token IS NULL AND locked_until IS NULL
            AND resource_id IS NOT NULL AND result_payload IS NOT NULL)
    ),
    CONSTRAINT plugin_command_receipts_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX plugin_command_receipts_status_idx
    ON plugin_command_receipts (plugin_key, status, locked_until, idempotency_key);

CREATE TABLE plugin_execution_leases (
    plugin_id uuid PRIMARY KEY REFERENCES plugins(id) ON DELETE CASCADE,
    lock_token uuid NOT NULL,
    locked_until timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugin_execution_leases_window_valid CHECK (locked_until > updated_at),
    CONSTRAINT plugin_execution_leases_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX plugin_execution_leases_expiry_idx
    ON plugin_execution_leases (locked_until, plugin_id);

CREATE TABLE plugin_storage_objects (
    plugin_id uuid NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    storage_key varchar(160) NOT NULL,
    value bytea NOT NULL,
    content_type varchar(120) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes integer GENERATED ALWAYS AS (octet_length(value)) STORED,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plugin_id, storage_key),
    CONSTRAINT plugin_storage_objects_key_valid CHECK (
        storage_key ~ '^[a-z][a-z0-9_.:-]{0,159}$'
    ),
    CONSTRAINT plugin_storage_objects_content_type_valid CHECK (
        char_length(content_type) BETWEEN 1 AND 120
        AND content_type = btrim(content_type)
        AND content_type !~ '[[:cntrl:]]'
    ),
    CONSTRAINT plugin_storage_objects_size_valid CHECK (size_bytes BETWEEN 0 AND 65536),
    CONSTRAINT plugin_storage_objects_revision_positive CHECK (revision > 0),
    CONSTRAINT plugin_storage_objects_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX plugin_storage_objects_updated_idx
    ON plugin_storage_objects (plugin_id, updated_at DESC, storage_key);

CREATE TABLE plugin_event_catalog (
    event_type varchar(80) PRIMARY KEY,
    event_kind varchar(40) NOT NULL UNIQUE,
    payload_schema_version smallint NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugin_event_catalog_type_valid CHECK (
        event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    ),
    CONSTRAINT plugin_event_catalog_kind_valid CHECK (
        event_kind ~ '^[a-z][a-z0-9-]{1,39}$'
    ),
    CONSTRAINT plugin_event_catalog_version_positive CHECK (payload_schema_version > 0),
    CONSTRAINT plugin_event_catalog_updated_after_created CHECK (updated_at >= created_at)
);

INSERT INTO plugin_event_catalog (event_type, event_kind)
VALUES
    ('user.created', 'user-created'),
    ('topic.published', 'topic-published'),
    ('reply.created', 'reply-created'),
    ('points.changed', 'points-changed'),
    ('experience.changed', 'experience-changed'),
    ('entitlement.changed', 'entitlement-changed')
ON CONFLICT (event_type) DO NOTHING;

CREATE TABLE plugin_event_subscriptions (
    plugin_id uuid NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    event_type varchar(80) NOT NULL REFERENCES plugin_event_catalog(event_type) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plugin_id, event_type),
    CONSTRAINT plugin_event_subscriptions_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX plugin_event_subscriptions_event_idx
    ON plugin_event_subscriptions (event_type, enabled, plugin_id);

CREATE FUNCTION daoyun_require_plugin_event_capability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM plugins
        WHERE id = NEW.plugin_id
          AND business_api_version = '0.1.0'
          AND capabilities ? 'events.subscribe'
          AND event_subscriptions ? NEW.event_type
    ) THEN
        RAISE EXCEPTION 'plugin does not declare the event subscription'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_event_subscriptions_require_capability
BEFORE INSERT OR UPDATE OF plugin_id, event_type ON plugin_event_subscriptions
FOR EACH ROW EXECUTE FUNCTION daoyun_require_plugin_event_capability();

CREATE FUNCTION daoyun_sync_plugin_event_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM plugin_event_subscriptions
    WHERE plugin_id = NEW.id
      AND NOT (NEW.event_subscriptions ? event_type);

    INSERT INTO plugin_event_subscriptions (plugin_id, event_type, enabled, updated_at)
    SELECT NEW.id, subscription.event_type, TRUE, CURRENT_TIMESTAMP
    FROM jsonb_array_elements_text(NEW.event_subscriptions) AS subscription(event_type)
    ON CONFLICT (plugin_id, event_type) DO UPDATE
    SET enabled = TRUE,
        updated_at = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER plugins_sync_event_subscriptions
AFTER INSERT OR UPDATE OF event_subscriptions, capabilities, business_api_version ON plugins
FOR EACH ROW EXECUTE FUNCTION daoyun_sync_plugin_event_subscriptions();

INSERT INTO plugin_event_subscriptions (plugin_id, event_type)
SELECT plugin.id, subscription.event_type
FROM plugins AS plugin
CROSS JOIN LATERAL jsonb_array_elements_text(plugin.event_subscriptions)
    AS subscription(event_type)
ON CONFLICT (plugin_id, event_type) DO NOTHING;

CREATE TABLE plugin_event_deliveries (
    plugin_id uuid NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
    event_type varchar(80) NOT NULL REFERENCES plugin_event_catalog(event_type) ON DELETE RESTRICT,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_schema_version smallint NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts smallint NOT NULL DEFAULT 0,
    max_attempts smallint NOT NULL DEFAULT 8,
    available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lock_token uuid,
    locked_until timestamptz,
    last_error varchar(500),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (plugin_id, outbox_event_id),
    CONSTRAINT plugin_event_deliveries_payload_valid CHECK (
        payload <> 'null'::jsonb AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT plugin_event_deliveries_version_positive CHECK (payload_schema_version > 0),
    CONSTRAINT plugin_event_deliveries_status_valid CHECK (
        status IN ('pending', 'processing', 'completed', 'dead')
    ),
    CONSTRAINT plugin_event_deliveries_attempts_valid CHECK (
        attempts BETWEEN 0 AND 25
        AND max_attempts BETWEEN 1 AND 25
        AND attempts <= max_attempts
    ),
    CONSTRAINT plugin_event_deliveries_error_valid CHECK (
        last_error IS NULL OR (
            char_length(last_error) BETWEEN 1 AND 500
            AND last_error !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT plugin_event_deliveries_state_consistent CHECK (
        (status = 'pending' AND attempts < max_attempts
            AND lock_token IS NULL AND locked_until IS NULL AND completed_at IS NULL)
        OR (status = 'processing' AND attempts >= 1
            AND lock_token IS NOT NULL AND locked_until IS NOT NULL AND completed_at IS NULL)
        OR (status = 'completed' AND attempts >= 1
            AND lock_token IS NULL AND locked_until IS NULL AND completed_at IS NOT NULL)
        OR (status = 'dead' AND attempts >= 1
            AND lock_token IS NULL AND locked_until IS NULL
            AND completed_at IS NULL AND last_error IS NOT NULL)
    ),
    CONSTRAINT plugin_event_deliveries_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX plugin_event_deliveries_claim_idx
    ON plugin_event_deliveries (available_at, created_at, outbox_event_id)
    WHERE status = 'pending';
CREATE INDEX plugin_event_deliveries_lease_idx
    ON plugin_event_deliveries (locked_until, outbox_event_id)
    WHERE status = 'processing';
CREATE INDEX plugin_event_deliveries_plugin_history_idx
    ON plugin_event_deliveries (plugin_id, status, created_at DESC, outbox_event_id DESC);

CREATE FUNCTION daoyun_fanout_plugin_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO plugin_event_deliveries (
        plugin_id, outbox_event_id, event_type, aggregate_id, payload,
        payload_schema_version, created_at, updated_at
    )
    SELECT
        subscriptions.plugin_id, NEW.id, NEW.event_type, NEW.aggregate_id, NEW.payload,
        catalog.payload_schema_version, NEW.created_at, NEW.created_at
    FROM plugin_event_subscriptions AS subscriptions
    INNER JOIN plugin_event_catalog AS catalog
        ON catalog.event_type = subscriptions.event_type
    INNER JOIN plugins AS plugin ON plugin.id = subscriptions.plugin_id
    WHERE subscriptions.event_type = NEW.event_type
      AND subscriptions.enabled
      AND catalog.enabled
      AND plugin.status = 'enabled'
      AND plugin.business_api_version = '0.1.0'
      AND plugin.capabilities ? 'events.subscribe'
    ON CONFLICT (plugin_id, outbox_event_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_events_fanout_plugins
AFTER INSERT ON outbox_events
FOR EACH ROW EXECUTE FUNCTION daoyun_fanout_plugin_event();

CREATE TABLE plugin_tasks (
    id uuid PRIMARY KEY,
    plugin_id uuid NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    task_key varchar(80) NOT NULL,
    idempotency_key varchar(160) NOT NULL,
    payload jsonb NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    run_at timestamptz NOT NULL,
    available_at timestamptz NOT NULL,
    attempts smallint NOT NULL DEFAULT 0,
    max_attempts smallint NOT NULL DEFAULT 8,
    lock_token uuid,
    locked_until timestamptz,
    last_error varchar(500),
    completed_at timestamptz,
    dead_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugin_tasks_key_valid CHECK (
        task_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    ),
    CONSTRAINT plugin_tasks_idempotency_key_valid CHECK (
        char_length(idempotency_key) BETWEEN 1 AND 160
        AND idempotency_key !~ '[[:cntrl:]]'
    ),
    CONSTRAINT plugin_tasks_payload_valid CHECK (
        payload <> 'null'::jsonb AND octet_length(payload::text) <= 65536
    ),
    CONSTRAINT plugin_tasks_status_valid CHECK (
        status IN ('pending', 'processing', 'completed', 'dead')
    ),
    CONSTRAINT plugin_tasks_attempts_valid CHECK (
        attempts BETWEEN 0 AND 25
        AND max_attempts BETWEEN 1 AND 25
        AND attempts <= max_attempts
    ),
    CONSTRAINT plugin_tasks_error_valid CHECK (
        last_error IS NULL OR (
            char_length(last_error) BETWEEN 1 AND 500
            AND last_error !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT plugin_tasks_schedule_valid CHECK (available_at >= run_at),
    CONSTRAINT plugin_tasks_state_consistent CHECK (
        (status = 'pending' AND attempts < max_attempts
            AND lock_token IS NULL AND locked_until IS NULL
            AND completed_at IS NULL AND dead_at IS NULL)
        OR (status = 'processing' AND attempts >= 1
            AND lock_token IS NOT NULL AND locked_until IS NOT NULL
            AND completed_at IS NULL AND dead_at IS NULL)
        OR (status = 'completed' AND attempts >= 1
            AND lock_token IS NULL AND locked_until IS NULL
            AND completed_at IS NOT NULL AND dead_at IS NULL)
        OR (status = 'dead' AND attempts >= 1
            AND lock_token IS NULL AND locked_until IS NULL
            AND completed_at IS NULL AND dead_at IS NOT NULL AND last_error IS NOT NULL)
    ),
    CONSTRAINT plugin_tasks_updated_after_created CHECK (updated_at >= created_at),
    CONSTRAINT plugin_tasks_idempotency_unique UNIQUE (plugin_id, idempotency_key)
);

CREATE INDEX plugin_tasks_claim_idx
    ON plugin_tasks (available_at, created_at, id)
    WHERE status = 'pending';
CREATE INDEX plugin_tasks_lease_idx
    ON plugin_tasks (locked_until, id)
    WHERE status = 'processing';
CREATE INDEX plugin_tasks_plugin_history_idx
    ON plugin_tasks (plugin_id, status, created_at DESC, id DESC);

CREATE FUNCTION daoyun_require_plugin_task_capability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    task_limit integer;
    pending_count integer;
BEGIN
    SELECT quotas.pending_task_limit INTO task_limit
    FROM plugins AS plugin
    INNER JOIN plugin_runtime_quotas AS quotas ON quotas.plugin_id = plugin.id
    WHERE plugin.id = NEW.plugin_id
      AND plugin.status = 'enabled'
      AND plugin.business_api_version = '0.1.0'
      AND plugin.capabilities ? 'tasks.schedule'
    FOR UPDATE OF quotas;
    IF task_limit IS NULL THEN
        RAISE EXCEPTION 'enabled plugin does not declare tasks.schedule'
            USING ERRCODE = '23514';
    END IF;
    SELECT COUNT(*)::integer INTO pending_count
    FROM plugin_tasks
    WHERE plugin_id = NEW.plugin_id AND status IN ('pending', 'processing');
    IF pending_count >= task_limit THEN
        RAISE EXCEPTION 'plugin pending task quota exceeded'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_tasks_require_capability
BEFORE INSERT ON plugin_tasks
FOR EACH ROW EXECUTE FUNCTION daoyun_require_plugin_task_capability();

CREATE TABLE plugin_task_attempts (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES plugin_tasks(id) ON DELETE CASCADE,
    attempt_no smallint NOT NULL,
    worker_token uuid NOT NULL,
    status varchar(16) NOT NULL,
    started_at timestamptz NOT NULL,
    leased_until timestamptz NOT NULL,
    finished_at timestamptz,
    error_code varchar(80),
    error_summary varchar(500),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plugin_task_attempts_number_valid CHECK (attempt_no BETWEEN 1 AND 25),
    CONSTRAINT plugin_task_attempts_status_valid CHECK (
        status IN ('processing', 'completed', 'failed', 'dead')
    ),
    CONSTRAINT plugin_task_attempts_error_valid CHECK (
        error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    ),
    CONSTRAINT plugin_task_attempts_summary_valid CHECK (
        error_summary IS NULL OR (
            char_length(error_summary) BETWEEN 1 AND 500
            AND error_summary !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT plugin_task_attempts_time_valid CHECK (
        leased_until > started_at AND (finished_at IS NULL OR finished_at >= started_at)
    ),
    CONSTRAINT plugin_task_attempts_state_consistent CHECK (
        (status = 'processing' AND finished_at IS NULL
            AND error_code IS NULL AND error_summary IS NULL)
        OR (status = 'completed' AND finished_at IS NOT NULL
            AND error_code IS NULL AND error_summary IS NULL)
        OR (status IN ('failed', 'dead') AND finished_at IS NOT NULL
            AND error_code IS NOT NULL AND error_summary IS NOT NULL)
    ),
    CONSTRAINT plugin_task_attempts_task_number_unique UNIQUE (task_id, attempt_no)
);

CREATE INDEX plugin_task_attempts_task_idx
    ON plugin_task_attempts (task_id, attempt_no DESC);
CREATE INDEX plugin_task_attempts_status_idx
    ON plugin_task_attempts (status, created_at DESC, id DESC);
