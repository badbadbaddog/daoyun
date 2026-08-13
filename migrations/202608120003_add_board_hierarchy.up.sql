ALTER TABLE boards
    ADD COLUMN parent_id uuid REFERENCES boards(id),
    ADD COLUMN revision bigint NOT NULL DEFAULT 1,
    ADD CONSTRAINT boards_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
    ADD CONSTRAINT boards_revision_positive CHECK (revision > 0);

CREATE INDEX boards_admin_tree_order
    ON boards (parent_id, position, id)
    WHERE deleted_at IS NULL;
