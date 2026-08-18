DROP FUNCTION IF EXISTS daoyun_board_scope_covers(uuid, text, uuid);

ALTER TABLE role_assignments
    DROP CONSTRAINT IF EXISTS role_assignments_scope_mode_valid;

ALTER TABLE role_assignments
    DROP COLUMN IF EXISTS scope_mode;
