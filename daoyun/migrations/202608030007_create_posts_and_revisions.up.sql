CREATE TABLE posts (
    id uuid PRIMARY KEY,
    topic_id uuid NOT NULL REFERENCES topics (id),
    author_id uuid NOT NULL REFERENCES users (id),
    kind varchar(16) NOT NULL,
    content text NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'published',
    revision_count integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT posts_kind_valid CHECK (kind IN ('topic', 'reply')),
    CONSTRAINT posts_status_valid CHECK (status IN ('draft', 'published', 'hidden')),
    CONSTRAINT posts_content_length CHECK (char_length(content) BETWEEN 1 AND 1000000),
    CONSTRAINT posts_revision_count_positive CHECK (revision_count >= 1)
);

CREATE UNIQUE INDEX posts_active_topic_unique
    ON posts (topic_id)
    WHERE kind = 'topic' AND deleted_at IS NULL;

CREATE INDEX posts_public_replies_index
    ON posts (topic_id, created_at ASC, id ASC)
    WHERE kind = 'reply' AND status = 'published' AND deleted_at IS NULL;

CREATE TABLE post_revisions (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    editor_id uuid NOT NULL REFERENCES users (id),
    revision_number integer NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT post_revisions_number_positive CHECK (revision_number >= 1),
    CONSTRAINT post_revisions_content_length CHECK (char_length(content) BETWEEN 1 AND 1000000),
    CONSTRAINT post_revisions_post_number_unique UNIQUE (post_id, revision_number)
);

INSERT INTO posts (id, topic_id, author_id, kind, content, status, revision_count, created_at, updated_at, deleted_at)
SELECT id, id, author_id, 'topic', content, status, 1, created_at, updated_at, deleted_at
FROM topics
WHERE deleted_at IS NULL;

INSERT INTO post_revisions (id, post_id, editor_id, revision_number, content, created_at)
SELECT gen_random_uuid(), id, author_id, 1, content, created_at
FROM topics
WHERE deleted_at IS NULL;
