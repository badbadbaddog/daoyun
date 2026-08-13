DROP INDEX IF EXISTS boards_admin_tree_order;

ALTER TABLE boards
    DROP CONSTRAINT IF EXISTS boards_revision_positive,
    DROP CONSTRAINT IF EXISTS boards_parent_not_self,
    DROP COLUMN IF EXISTS revision,
    DROP COLUMN IF EXISTS parent_id;
