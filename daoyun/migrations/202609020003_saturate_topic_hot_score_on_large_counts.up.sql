CREATE OR REPLACE FUNCTION daoyun_recompute_topic_hot_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.hot_score := LEAST(
        9223372036854775807::numeric,
        GREATEST(
            0::numeric,
            (NEW.like_count::numeric * 8) + (NEW.reply_count::numeric * 12)
        )
    )::bigint;
    RETURN NEW;
END;
$$;

UPDATE topics
SET hot_score = LEAST(
    9223372036854775807::numeric,
    GREATEST(
        0::numeric,
        (like_count::numeric * 8) + (reply_count::numeric * 12)
    )
)::bigint;
