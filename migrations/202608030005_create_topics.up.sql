CREATE TABLE topics (
    id uuid PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES boards (id),
    author_id uuid NOT NULL REFERENCES users (id),
    title varchar(160) NOT NULL,
    excerpt varchar(500) NOT NULL DEFAULT '',
    content text NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'draft',
    published_at timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    featured_at timestamptz,
    pinned_at timestamptz,
    hot_score bigint NOT NULL DEFAULT 0,
    reply_count bigint NOT NULL DEFAULT 0,
    like_count bigint NOT NULL DEFAULT 0,
    view_count bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT topics_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
    CONSTRAINT topics_title_no_control CHECK (title !~ '[[:cntrl:]]'),
    CONSTRAINT topics_excerpt_length CHECK (char_length(excerpt) <= 500),
    CONSTRAINT topics_excerpt_no_control CHECK (excerpt !~ '[[:cntrl:]]'),
    CONSTRAINT topics_content_length CHECK (char_length(content) BETWEEN 1 AND 1000000),
    CONSTRAINT topics_status_valid CHECK (status IN ('draft', 'published', 'hidden')),
    CONSTRAINT topics_published_at_required CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT topics_activity_after_publish CHECK (
        published_at IS NULL OR last_activity_at >= published_at
    ),
    CONSTRAINT topics_featured_only_when_published CHECK (
        featured_at IS NULL OR status = 'published'
    ),
    CONSTRAINT topics_pinned_only_when_published CHECK (
        pinned_at IS NULL OR status = 'published'
    ),
    CONSTRAINT topics_hot_score_non_negative CHECK (hot_score >= 0),
    CONSTRAINT topics_reply_count_non_negative CHECK (reply_count >= 0),
    CONSTRAINT topics_like_count_non_negative CHECK (like_count >= 0),
    CONSTRAINT topics_view_count_non_negative CHECK (view_count >= 0)
);

CREATE INDEX topics_public_latest_index
    ON topics (((pinned_at IS NOT NULL)) DESC, published_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX topics_public_popular_index
    ON topics (((pinned_at IS NOT NULL)) DESC, hot_score DESC, published_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX topics_public_active_index
    ON topics (((pinned_at IS NOT NULL)) DESC, last_activity_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX topics_public_board_index
    ON topics (board_id, published_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX topics_public_featured_index
    ON topics (featured_at DESC, published_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL AND featured_at IS NOT NULL;
