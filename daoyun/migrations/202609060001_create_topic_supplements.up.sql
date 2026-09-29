CREATE TABLE topic_supplement_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled boolean NOT NULL DEFAULT false,
    max_per_topic integer NOT NULL DEFAULT 1 CHECK (max_per_topic BETWEEN 0 AND 100)
);
INSERT INTO topic_supplement_settings (id) VALUES (1);

ALTER TABLE boards ADD COLUMN supplement_requires_review boolean NOT NULL DEFAULT true;

CREATE TABLE topic_supplements (
    id uuid PRIMARY KEY,
    topic_id uuid NOT NULL REFERENCES topics(id),
    author_id uuid NOT NULL REFERENCES users(id),
    content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
    status varchar(16) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'hidden')),
    idempotency_key varchar(128) NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (topic_id, author_id, idempotency_key)
);
CREATE INDEX topic_supplements_topic_order ON topic_supplements(topic_id, created_at, id);
CREATE INDEX topic_supplements_pending ON topic_supplements(created_at, id) WHERE status = 'pending';
