CREATE INDEX topics_public_recommended_index
    ON topics (hot_score DESC, published_at DESC, id DESC)
    WHERE status = 'published' AND deleted_at IS NULL;
