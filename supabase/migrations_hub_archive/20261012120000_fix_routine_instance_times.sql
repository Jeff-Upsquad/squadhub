-- Backfill routine instances that were spawned without work/start dates.
--
-- Bug: spawnRoutineInstance() copied only due_date (defaulting to 18:00 IST
-- when the template had no due time) and dropped work_date/start_date. Every
-- timed routine (e.g. "Bath and getting ready" 9:00am) therefore rendered a
-- phantom 6pm block via the Day Planner's date-derived occurrences, alongside
-- the user's real 9am placement.
--
-- Fix (code): the spawner now carries the template's work/start clock times
-- onto the occurrence date. This migration repairs already-spawned copies by
-- copying the parent template's IST wall-clock times onto the instance's
-- recurrence_instance_date. due_date is left untouched: date occurrences
-- prefer work over due, so the calendar moves to the right time while
-- Today/Overdue bucketing is unchanged.

-- Copy work_date from parent template where the instance has none.
UPDATE tasks AS i
SET work_date = (
  (i.recurrence_instance_date::timestamp + (p.work_date AT TIME ZONE 'Asia/Kolkata')::time)
    AT TIME ZONE 'Asia/Kolkata'
)
FROM tasks AS p
WHERE i.recurring_parent_id = p.id
  AND i.recurrence_instance_date IS NOT NULL
  AND i.work_date IS NULL
  AND p.work_date IS NOT NULL;

-- Copy start_date from parent template where the instance has none.
UPDATE tasks AS i
SET start_date = (
  (i.recurrence_instance_date::timestamp + (p.start_date AT TIME ZONE 'Asia/Kolkata')::time)
    AT TIME ZONE 'Asia/Kolkata'
)
FROM tasks AS p
WHERE i.recurring_parent_id = p.id
  AND i.recurrence_instance_date IS NOT NULL
  AND i.start_date IS NULL
  AND p.start_date IS NOT NULL;
