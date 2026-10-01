import { z } from 'zod';

export function validateWorkRange(start: unknown, end: unknown) {
  if (end != null && (typeof end !== 'string' || !Number.isFinite(Date.parse(end)))) {
    throw new z.ZodError([{ code: 'custom', path: ['metadata', 'work_end_date'], message: 'Choose a valid work end date' }]);
  }
  if (start && end && Date.parse(end as string) < Date.parse(start as string)) {
    throw new z.ZodError([{ code: 'custom', path: ['metadata', 'work_end_date'], message: 'Work end date must be on or after work start date' }]);
  }
}

