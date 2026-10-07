ALTER TABLE experience_ledger_entries
    ADD COLUMN actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN details varchar(500),
    ADD COLUMN operation_request_id uuid,
    ADD COLUMN audit_id uuid REFERENCES admin_audit_log(id) ON DELETE RESTRICT,
    ADD COLUMN revision_after bigint CHECK (revision_after > 0);
