DROP TABLE topic_attachments;
DROP TABLE topic_moderation_actions;
ALTER TABLE topics
    DROP CONSTRAINT topics_moderation_status_valid,
    DROP CONSTRAINT topics_published_requires_approval,
    DROP COLUMN moderation_status;
