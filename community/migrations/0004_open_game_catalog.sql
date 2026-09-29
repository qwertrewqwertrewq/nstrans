-- Games no longer require moderation. Existing pending submissions become
-- immediately available. Previously rejected records remain hidden so an old
-- moderation decision is never silently reversed; legacy status columns stay
-- in place for deployment compatibility.
UPDATE games
SET status = 'approved', approved_by = NULL, updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending';
