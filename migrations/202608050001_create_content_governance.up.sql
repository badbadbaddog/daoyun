CREATE TABLE content_reports (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL REFERENCES users (id),
    target_type varchar(16) NOT NULL,
    target_id uuid NOT NULL,
    reason varchar(32) NOT NULL,
    details varchar(1000),
    status varchar(16) NOT NULL DEFAULT 'open',
    resolution varchar(32) NOT NULL DEFAULT 'none',
    resolution_note varchar(1000),
    reviewer_id uuid REFERENCES users (id),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT content_reports_target_type_valid CHECK (target_type IN ('topic', 'post')),
    CONSTRAINT content_reports_reason_valid CHECK (
        reason IN ('spam', 'harassment', 'illegal', 'copyright', 'other')
    ),
    CONSTRAINT content_reports_details_length CHECK (
        details IS NULL OR char_length(details) BETWEEN 1 AND 1000
    ),
    CONSTRAINT content_reports_status_valid CHECK (
        status IN ('open', 'in_review', 'resolved', 'dismissed')
    ),
    CONSTRAINT content_reports_resolution_valid CHECK (
        resolution IN ('none', 'hide_topic', 'hide_post', 'suspend_author', 'dismiss')
    ),
    CONSTRAINT content_reports_resolution_note_length CHECK (
        resolution_note IS NULL OR char_length(resolution_note) BETWEEN 1 AND 1000
    ),
    CONSTRAINT content_reports_resolved_at_consistent CHECK (
        (status IN ('resolved', 'dismissed') AND resolved_at IS NOT NULL)
        OR (status IN ('open', 'in_review') AND resolved_at IS NULL)
    ),
    CONSTRAINT content_reports_unique_reporter_target UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX content_reports_status_time_index
    ON content_reports (status, created_at DESC, id DESC);

CREATE INDEX content_reports_target_index
    ON content_reports (target_type, target_id, created_at DESC, id DESC);

CREATE INDEX content_reports_reporter_time_index
    ON content_reports (reporter_id, created_at DESC, id DESC);
