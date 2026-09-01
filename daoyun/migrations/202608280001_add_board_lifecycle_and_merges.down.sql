DROP TABLE IF EXISTS board_merge_topics;
DROP TABLE IF EXISTS board_merge_operations;

ALTER TABLE boards
    DROP CONSTRAINT IF EXISTS boards_merged_target_valid,
    DROP CONSTRAINT IF EXISTS boards_status_valid,
    DROP COLUMN IF EXISTS merged_into_board_id,
    DROP COLUMN IF EXISTS status;
