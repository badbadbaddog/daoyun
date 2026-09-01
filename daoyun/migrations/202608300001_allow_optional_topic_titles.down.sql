UPDATE topics
SET title = LEFT(COALESCE(NULLIF(excerpt, ''), '无标题'), 160)
WHERE title = '';

ALTER TABLE topics
    DROP CONSTRAINT topics_title_length;

ALTER TABLE topics
    ADD CONSTRAINT topics_title_length
    CHECK (char_length(title) BETWEEN 1 AND 160);
