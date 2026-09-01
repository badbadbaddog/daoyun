ALTER TABLE boards
    ADD COLUMN status varchar(16) NOT NULL DEFAULT 'open',
    ADD COLUMN merged_into_board_id uuid REFERENCES boards(id),
    ADD CONSTRAINT boards_status_valid
        CHECK (status IN ('open', 'read_only', 'hidden', 'archived', 'merged')),
    ADD CONSTRAINT boards_merged_target_valid
        CHECK ((status = 'merged') = (merged_into_board_id IS NOT NULL));

UPDATE boards
SET status = 'hidden'
WHERE visibility = 'hidden' AND deleted_at IS NULL;

CREATE TABLE board_merge_operations (
    id uuid PRIMARY KEY,
    audit_id uuid NOT NULL UNIQUE REFERENCES admin_audit_log(id),
    source_board_id uuid NOT NULL REFERENCES boards(id),
    target_board_id uuid NOT NULL REFERENCES boards(id),
    idempotency_key varchar(128) NOT NULL UNIQUE,
    source_revision_before bigint NOT NULL,
    source_revision_after bigint NOT NULL,
    target_revision_before bigint NOT NULL,
    target_revision_after bigint NOT NULL,
    source_previous_status varchar(16) NOT NULL,
    source_previous_visibility varchar(16) NOT NULL,
    moved_topic_count bigint NOT NULL,
    merged_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rollback_deadline timestamptz NOT NULL,
    rolled_back_at timestamptz,
    rollback_audit_id uuid UNIQUE REFERENCES admin_audit_log(id),
    rollback_idempotency_key varchar(128) UNIQUE,
    CONSTRAINT board_merge_distinct_boards CHECK (source_board_id <> target_board_id),
    CONSTRAINT board_merge_topic_count_non_negative CHECK (moved_topic_count >= 0)
);

CREATE INDEX board_merge_operations_source_time
    ON board_merge_operations (source_board_id, merged_at DESC);

CREATE TABLE board_merge_topics (
    operation_id uuid NOT NULL REFERENCES board_merge_operations(id) ON DELETE CASCADE,
    topic_id uuid NOT NULL REFERENCES topics(id),
    PRIMARY KEY (operation_id, topic_id)
);

CREATE INDEX board_merge_topics_topic_id
    ON board_merge_topics (topic_id);
