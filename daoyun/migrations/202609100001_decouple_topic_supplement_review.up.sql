UPDATE topic_supplements SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending';
UPDATE topic_supplements SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE status = 'rejected';

DROP INDEX topic_supplements_pending;
ALTER TABLE topic_supplements DROP CONSTRAINT topic_supplements_status_check;
ALTER TABLE topic_supplements ADD CONSTRAINT topic_supplements_status_check CHECK (status IN ('approved', 'hidden'));
ALTER TABLE boards DROP COLUMN supplement_requires_review;
