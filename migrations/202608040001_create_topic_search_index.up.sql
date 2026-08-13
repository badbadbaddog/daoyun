ALTER TABLE topics
    ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(content, '')), 'C')
    ) STORED;

CREATE INDEX topics_public_search_index
    ON topics USING GIN (search_vector)
    WHERE status = 'published' AND deleted_at IS NULL;
