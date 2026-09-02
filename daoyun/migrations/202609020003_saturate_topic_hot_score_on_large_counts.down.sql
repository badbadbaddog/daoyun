CREATE OR REPLACE FUNCTION daoyun_recompute_topic_hot_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.hot_score := GREATEST(
        0::bigint,
        (NEW.like_count * 8) + (NEW.reply_count * 12)
    );
    RETURN NEW;
END;
$$;
