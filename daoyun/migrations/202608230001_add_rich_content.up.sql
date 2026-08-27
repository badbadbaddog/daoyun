ALTER TABLE posts
    ADD COLUMN rich_content JSONB;

ALTER TABLE post_revisions
    ADD COLUMN rich_content JSONB;
