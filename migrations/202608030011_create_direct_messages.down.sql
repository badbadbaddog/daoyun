ALTER TABLE conversation_members
    DROP CONSTRAINT conversation_members_last_read_message_fk;

DROP TABLE direct_messages;
DROP TABLE conversation_members;
DROP TABLE direct_conversations;
