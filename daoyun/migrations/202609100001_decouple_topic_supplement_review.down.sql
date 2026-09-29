ALTER TABLE boards ADD COLUMN supplement_requires_review boolean NOT NULL DEFAULT false;
ALTER TABLE topic_supplements DROP CONSTRAINT topic_supplements_status_check;
ALTER TABLE topic_supplements ADD CONSTRAINT topic_supplements_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'hidden'));
CREATE INDEX topic_supplements_pending ON topic_supplements(created_at, id) WHERE status = 'pending';
