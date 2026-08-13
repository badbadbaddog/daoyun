DROP INDEX IF EXISTS topics_public_search_index;
ALTER TABLE topics DROP COLUMN IF EXISTS search_vector;
