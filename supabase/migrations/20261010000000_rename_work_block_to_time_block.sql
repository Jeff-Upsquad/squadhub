-- ============================================================
-- Rename the `work_block` task type's display label from
-- "Work Block" to "Time Block".
--
-- Only the user-facing name moves. The type key (`work_block`),
-- table names, API paths and CSS `data-type="work_block"`
-- attributes are intentionally left alone so no code, query key
-- or selector has to change with them.
-- ============================================================

UPDATE task_types
SET name = 'Time Block'
WHERE key = 'work_block';
