ALTER TABLE posts
    ADD COLUMN floor_number bigint,
    ADD COLUMN reply_to_id uuid REFERENCES posts (id) ON DELETE SET NULL;

WITH numbered_replies AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY created_at ASC, id ASC) AS floor_number
    FROM posts
    WHERE kind = 'reply'
)
UPDATE posts AS reply
SET floor_number = numbered.floor_number
FROM numbered_replies AS numbered
WHERE reply.id = numbered.id;

ALTER TABLE posts
    ADD CONSTRAINT posts_reply_floor_valid CHECK (
        (kind = 'reply' AND floor_number IS NOT NULL AND floor_number > 0)
        OR (kind <> 'reply' AND floor_number IS NULL AND reply_to_id IS NULL)
    );

CREATE UNIQUE INDEX posts_reply_floor_unique
    ON posts (topic_id, floor_number)
    WHERE kind = 'reply';

CREATE INDEX posts_reply_target_index
    ON posts (reply_to_id)
    WHERE reply_to_id IS NOT NULL;
