DROP TABLE post_likes;
DROP TABLE topic_bookmarks;

ALTER TABLE posts
    DROP CONSTRAINT posts_like_count_non_negative,
    DROP COLUMN like_count;
