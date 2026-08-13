DROP TABLE user_blocks;
DROP TABLE user_follows;

ALTER TABLE users
    DROP CONSTRAINT users_following_count_non_negative,
    DROP CONSTRAINT users_follower_count_non_negative,
    DROP CONSTRAINT users_profile_revision_positive,
    DROP CONSTRAINT users_website_url_http,
    DROP CONSTRAINT users_location_valid,
    DROP CONSTRAINT users_bio_length,
    DROP CONSTRAINT users_avatar_url_https,
    DROP COLUMN following_count,
    DROP COLUMN follower_count,
    DROP COLUMN profile_revision,
    DROP COLUMN website_url,
    DROP COLUMN location,
    DROP COLUMN bio,
    DROP COLUMN avatar_url;
