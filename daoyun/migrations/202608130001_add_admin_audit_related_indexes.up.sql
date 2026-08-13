CREATE INDEX admin_audit_report_summary_idx
    ON admin_audit_log ((summary ->> 'report_id'), created_at DESC, id DESC)
    WHERE summary ? 'report_id';
