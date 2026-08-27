DROP INDEX IF EXISTS posts_reply_target_index;
DROP INDEX IF EXISTS posts_reply_floor_unique;

ALTER TABLE posts
    DROP CONSTRAINT IF EXISTS posts_reply_floor_valid,
    DROP COLUMN IF EXISTS reply_to_id,
    DROP COLUMN IF EXISTS floor_number;
