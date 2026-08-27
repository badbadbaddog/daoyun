DROP INDEX IF EXISTS topic_attachments_draft_owner_index;

DELETE FROM topic_attachments WHERE topic_id IS NULL;

ALTER TABLE topic_attachments
    ALTER COLUMN topic_id SET NOT NULL;
