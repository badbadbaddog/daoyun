ALTER TABLE users
    ADD COLUMN avatar_url varchar(2048),
    ADD COLUMN bio varchar(500) NOT NULL DEFAULT '',
    ADD COLUMN location varchar(100),
    ADD COLUMN website_url varchar(2048),
    ADD COLUMN profile_revision integer NOT NULL DEFAULT 1,
    ADD COLUMN follower_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN following_count bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT users_avatar_url_https CHECK (
        avatar_url IS NULL OR (
            char_length(avatar_url) BETWEEN 9 AND 2048
            AND avatar_url ~ '^https://[^[:space:]]+$'
        )
    ),
    ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 500),
    ADD CONSTRAINT users_location_valid CHECK (
        location IS NULL OR (
            char_length(location) BETWEEN 1 AND 100
            AND location !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT users_website_url_http CHECK (
        website_url IS NULL OR (
            char_length(website_url) BETWEEN 8 AND 2048
            AND website_url ~ '^https?://[^[:space:]]+$'
        )
    ),
    ADD CONSTRAINT users_profile_revision_positive CHECK (profile_revision >= 1),
    ADD CONSTRAINT users_follower_count_non_negative CHECK (follower_count >= 0),
    ADD CONSTRAINT users_following_count_non_negative CHECK (following_count >= 0);

CREATE TABLE user_follows (
    follower_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followed_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT user_follows_not_self CHECK (follower_id <> followed_id)
);

CREATE INDEX user_follows_followers_index
    ON user_follows (followed_id, created_at DESC, follower_id DESC);

CREATE INDEX user_follows_following_index
    ON user_follows (follower_id, created_at DESC, followed_id DESC);

CREATE TABLE user_blocks (
    blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX user_blocks_blocked_index ON user_blocks (blocked_id, blocker_id);
