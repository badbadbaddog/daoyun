ALTER TABLE experience_ledger_entries
    DROP COLUMN revision_after,
    DROP COLUMN audit_id,
    DROP COLUMN operation_request_id,
    DROP COLUMN details,
    DROP COLUMN actor_id;
