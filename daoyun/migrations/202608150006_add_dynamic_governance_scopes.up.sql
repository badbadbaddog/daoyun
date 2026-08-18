ALTER TABLE role_assignments
    ADD COLUMN scope_mode varchar(16) NOT NULL DEFAULT 'exact';

ALTER TABLE role_assignments
    ADD CONSTRAINT role_assignments_scope_mode_valid
        CHECK (scope_mode IN ('exact', 'subtree'));

CREATE OR REPLACE FUNCTION daoyun_board_scope_covers(
    assigned_board_id uuid,
    assigned_scope_mode text,
    target_board_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE ancestors AS (
        SELECT board.id, board.parent_id, ARRAY[board.id] AS visited
        FROM boards AS board
        WHERE board.id = target_board_id AND board.deleted_at IS NULL

        UNION ALL

        SELECT parent.id, parent.parent_id, ancestors.visited || parent.id
        FROM ancestors
        JOIN boards AS parent ON parent.id = ancestors.parent_id
        WHERE parent.deleted_at IS NULL
          AND NOT parent.id = ANY(ancestors.visited)
    )
    SELECT CASE assigned_scope_mode
        WHEN 'exact' THEN assigned_board_id = target_board_id
            AND EXISTS (
                SELECT 1 FROM boards
                WHERE id = assigned_board_id AND deleted_at IS NULL
            )
        WHEN 'subtree' THEN EXISTS (
            SELECT 1 FROM ancestors WHERE id = assigned_board_id
        )
        ELSE FALSE
    END
$$;
