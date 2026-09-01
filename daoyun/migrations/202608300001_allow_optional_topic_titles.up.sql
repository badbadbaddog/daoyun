ALTER TABLE topics
    DROP CONSTRAINT topics_title_length;

ALTER TABLE topics
    ADD CONSTRAINT topics_title_length
    CHECK (char_length(title) <= 160);
