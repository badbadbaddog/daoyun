CREATE TABLE community_quota_usage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quota_key varchar(80) NOT NULL,
    window_start date NOT NULL,
    used bigint NOT NULL DEFAULT 0,
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, quota_key, window_start),
    CONSTRAINT community_quota_usage_key_check
        CHECK (quota_key ~ '^[a-z][a-z0-9_.]{2,79}$'),
    CONSTRAINT community_quota_usage_used_check CHECK (used >= 0),
    CONSTRAINT community_quota_usage_revision_check CHECK (revision > 0)
);

CREATE INDEX community_quota_usage_window_idx
    ON community_quota_usage (window_start, quota_key);
