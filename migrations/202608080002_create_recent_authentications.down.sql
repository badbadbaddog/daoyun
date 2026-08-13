DROP TABLE IF EXISTS recent_authentications;

ALTER TABLE sessions
    DROP CONSTRAINT IF EXISTS sessions_id_user_unique;
