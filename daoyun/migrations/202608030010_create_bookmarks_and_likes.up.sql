ALTER TABLE posts
    ADD COLUMN like_count bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT posts_like_count_non_negative CHECK (like_count >= 0);

UPDATE posts AS post
SET like_count = topic.like_count
FROM topics AS topic
WHERE post.topic_id = topic.id AND post.kind = 'topic';

CREATE TABLE topic_bookmarks (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, topic_id)
);

CREATE INDEX topic_bookmarks_user_time_index
    ON topic_bookmarks (user_id, created_at DESC, topic_id DESC);

CREATE TABLE post_likes (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX post_likes_user_time_index
    ON post_likes (user_id, created_at DESC, post_id DESC);

CREATE INDEX post_likes_post_index
    ON post_likes (post_id, user_id);
