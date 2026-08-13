CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    recipient_id uuid NOT NULL REFERENCES users (id),
    actor_id uuid REFERENCES users (id),
    kind text NOT NULL CHECK (kind IN ('follow', 'reply', 'like', 'message')),
    target_type text NOT NULL CHECK (target_type IN ('user', 'topic', 'post', 'conversation')),
    target_id uuid NOT NULL,
    aggregate_key text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notifications_aggregate_unique UNIQUE (recipient_id, aggregate_key)
);

CREATE INDEX notifications_recipient_cursor_index
    ON notifications (recipient_id, created_at DESC, id DESC);

CREATE INDEX notifications_unread_index
    ON notifications (recipient_id, created_at DESC, id DESC)
    WHERE read_at IS NULL;
