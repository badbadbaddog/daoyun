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

CREATE TRIGGER topics_recompute_hot_score
BEFORE INSERT OR UPDATE OF like_count, reply_count
ON topics
FOR EACH ROW
EXECUTE FUNCTION daoyun_recompute_topic_hot_score();

UPDATE topics
SET hot_score = GREATEST(
    0::bigint,
    (like_count * 8) + (reply_count * 12)
);
