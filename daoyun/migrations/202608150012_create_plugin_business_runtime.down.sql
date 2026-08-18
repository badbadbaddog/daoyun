DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM plugins WHERE business_api_version IS NOT NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55006',
            MESSAGE = 'cannot roll back plugin business runtime while business plugins are installed';
    END IF;
END;
$$;

DROP TRIGGER plugin_tasks_require_capability ON plugin_tasks;
DROP FUNCTION daoyun_require_plugin_task_capability();
DROP TABLE plugin_task_attempts;
DROP TABLE plugin_tasks;

DROP TRIGGER outbox_events_fanout_plugins ON outbox_events;
DROP FUNCTION daoyun_fanout_plugin_event();
DROP TABLE plugin_event_deliveries;

DROP TRIGGER plugin_event_subscriptions_require_capability ON plugin_event_subscriptions;
DROP FUNCTION daoyun_require_plugin_event_capability();
DROP TRIGGER plugins_sync_event_subscriptions ON plugins;
DROP FUNCTION daoyun_sync_plugin_event_subscriptions();
DROP TABLE plugin_event_subscriptions;
DROP TABLE plugin_event_catalog;

DROP TABLE plugin_storage_objects;

DROP TABLE plugin_execution_leases;
DROP TABLE plugin_command_receipts;
DROP TABLE plugin_command_usage;

DROP TRIGGER plugins_seed_runtime_quotas ON plugins;
DROP FUNCTION daoyun_seed_plugin_runtime_quotas();
DROP TABLE plugin_runtime_quotas;

ALTER TABLE plugins
    DROP CONSTRAINT plugins_event_subscriptions_capability_required,
    DROP CONSTRAINT plugins_event_subscriptions_valid,
    DROP COLUMN event_subscriptions;
