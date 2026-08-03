CREATE TABLE boards (
    id uuid PRIMARY KEY,
    slug varchar(80) NOT NULL,
    name varchar(80) NOT NULL,
    description varchar(280) NOT NULL DEFAULT '',
    icon varchar(32) NOT NULL DEFAULT 'messages',
    tone varchar(16) NOT NULL DEFAULT 'green',
    position integer NOT NULL DEFAULT 0,
    visibility varchar(16) NOT NULL DEFAULT 'public',
    topic_count bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    deleted_by uuid,
    delete_reason varchar(500),
    CONSTRAINT boards_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT boards_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT boards_description_length CHECK (char_length(description) <= 280),
    CONSTRAINT boards_icon_format CHECK (icon ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT boards_tone_valid CHECK (tone IN ('green', 'blue', 'amber', 'rose')),
    CONSTRAINT boards_position_non_negative CHECK (position >= 0),
    CONSTRAINT boards_visibility_valid CHECK (visibility IN ('public', 'hidden')),
    CONSTRAINT boards_topic_count_non_negative CHECK (topic_count >= 0)
);

CREATE UNIQUE INDEX boards_active_slug_unique
    ON boards (slug)
    WHERE deleted_at IS NULL;

CREATE INDEX boards_public_order
    ON boards (position, id)
    WHERE visibility = 'public' AND deleted_at IS NULL;
