CREATE TABLE direct_conversations (
    id uuid PRIMARY KEY,
    user_low_id uuid NOT NULL REFERENCES users (id),
    user_high_id uuid NOT NULL REFERENCES users (id),
    last_message_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT direct_conversations_participant_order CHECK (user_low_id < user_high_id),
    CONSTRAINT direct_conversations_participants_unique UNIQUE (user_low_id, user_high_id),
    CONSTRAINT direct_conversations_update_order CHECK (updated_at >= created_at),
    CONSTRAINT direct_conversations_message_time_order CHECK (
        last_message_at IS NULL OR last_message_at >= created_at
    )
);

CREATE INDEX direct_conversations_activity_index
    ON direct_conversations (last_message_at DESC NULLS FIRST, id DESC);

CREATE TABLE conversation_members (
    conversation_id uuid NOT NULL REFERENCES direct_conversations (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id),
    last_read_message_id uuid,
    unread_count bigint NOT NULL DEFAULT 0,
    archived_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id),
    CONSTRAINT conversation_members_unread_non_negative CHECK (unread_count >= 0)
);

CREATE INDEX conversation_members_user_active_index
    ON conversation_members (user_id, conversation_id)
    WHERE archived_at IS NULL;

CREATE TABLE direct_messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES direct_conversations (id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users (id),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT direct_messages_content_length CHECK (
        char_length(btrim(content)) BETWEEN 1 AND 10000
    ),
    CONSTRAINT direct_messages_conversation_id_unique UNIQUE (conversation_id, id),
    CONSTRAINT direct_messages_sender_member_fk
        FOREIGN KEY (conversation_id, sender_id)
        REFERENCES conversation_members (conversation_id, user_id)
);

ALTER TABLE conversation_members
    ADD CONSTRAINT conversation_members_last_read_message_fk
    FOREIGN KEY (conversation_id, last_read_message_id)
    REFERENCES direct_messages (conversation_id, id);

CREATE INDEX direct_messages_conversation_time_index
    ON direct_messages (conversation_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
