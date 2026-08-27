ALTER TABLE topic_attachments
    ALTER COLUMN topic_id DROP NOT NULL;

CREATE INDEX topic_attachments_draft_owner_index
    ON topic_attachments (uploader_id, expires_at, created_at)
    WHERE topic_id IS NULL AND deleted_at IS NULL;
