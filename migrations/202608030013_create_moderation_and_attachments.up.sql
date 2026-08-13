ALTER TABLE topics
    ADD COLUMN moderation_status varchar(16) NOT NULL DEFAULT 'approved',
    ADD CONSTRAINT topics_moderation_status_valid
        CHECK (moderation_status IN ('approved', 'hidden', 'rejected')),
    ADD CONSTRAINT topics_published_requires_approval
        CHECK (status <> 'published' OR moderation_status = 'approved');

CREATE TABLE topic_moderation_actions (
    id uuid PRIMARY KEY,
    topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    moderator_id uuid NOT NULL REFERENCES users (id),
    action varchar(16) NOT NULL CHECK (action IN ('approved', 'hidden', 'rejected')),
    reason varchar(1000),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT topic_moderation_reason_length CHECK (reason IS NULL OR char_length(reason) <= 1000)
);

CREATE INDEX topic_moderation_actions_topic_time_index
    ON topic_moderation_actions (topic_id, created_at DESC, id DESC);

CREATE TABLE topic_attachments (
    id uuid PRIMARY KEY,
    topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    uploader_id uuid NOT NULL REFERENCES users (id),
    storage_key varchar(512) NOT NULL UNIQUE,
    original_name varchar(255) NOT NULL,
    mime_type varchar(127) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 bytea NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT topic_attachments_name_length CHECK (char_length(original_name) BETWEEN 1 AND 255),
    CONSTRAINT topic_attachments_mime_length CHECK (char_length(mime_type) BETWEEN 1 AND 127),
    CONSTRAINT topic_attachments_size_valid CHECK (size_bytes BETWEEN 1 AND 52428800),
    CONSTRAINT topic_attachments_sha256_length CHECK (octet_length(sha256) = 32),
    CONSTRAINT topic_attachments_status_valid CHECK (status IN ('pending', 'ready', 'rejected'))
);

CREATE INDEX topic_attachments_topic_index ON topic_attachments (topic_id, created_at, id);
