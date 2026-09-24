// Keep the companion's typed durations aligned with Squadra's estimate and
// logged-time fields: bare numbers are hours, a work day is eight hours.
const MINUTES_PER_UNIT: Record<string, number> = {
  w: 2400, week: 2400, weeks: 2400,
  d: 480, day: 480, days: 480,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
};

export function parseDuration(input: string): number | null {
  const body = input.trim().toLowerCase();
  if (!body) return null;
  const clock = body.match(/^(\d+):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+(?:\.\d+)?$/.test(body)) return Math.round(Number(body) * 60);

  const token = /(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)/gy;
  let index = 0;
  let total = 0;
  let found = false;
  while (index < body.length) {
    while (/[,\s]/.test(body[index] || '')) index++;
    if (index >= body.length) break;
    token.lastIndex = index;
    const match = token.exec(body);
    if (!match) return null;
    total += Number(match[1]) * MINUTES_PER_UNIT[match[2]];
    index = token.lastIndex;
    found = true;
  }
  return found ? Math.round(total) : null;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return [hours ? `${hours}h` : '', mins ? `${mins}m` : ''].filter(Boolean).join(' ') || '0m';
}
