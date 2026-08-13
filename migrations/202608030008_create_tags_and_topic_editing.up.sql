CREATE TABLE tags (
    id uuid PRIMARY KEY,
    slug varchar(40) NOT NULL UNIQUE,
    name varchar(40) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tags_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
    CONSTRAINT tags_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
    CONSTRAINT tags_name_no_control CHECK (name !~ '[[:cntrl:]]')
);

CREATE TABLE topic_tags (
    topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (topic_id, tag_id)
);

CREATE INDEX topic_tags_tag_topic_index ON topic_tags (tag_id, topic_id);
CREATE INDEX topic_tags_topic_index ON topic_tags (topic_id, tag_id);
