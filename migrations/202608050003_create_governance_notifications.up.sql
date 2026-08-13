ALTER TABLE notifications
    DROP CONSTRAINT notifications_kind_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ('follow', 'reply', 'like', 'message', 'report'));
