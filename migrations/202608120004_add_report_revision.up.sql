ALTER TABLE content_reports
    ADD COLUMN revision bigint NOT NULL DEFAULT 1,
    ADD CONSTRAINT content_reports_revision_positive CHECK (revision >= 1);
