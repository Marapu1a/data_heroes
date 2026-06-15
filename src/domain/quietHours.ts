import { DateTime } from 'luxon';

export interface QuietHoursConfig {
  startTime: string; // "HH:mm" 24-hour
  endTime: string;   // "HH:mm" 24-hour
  timezone: string;  // IANA timezone name
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Expects pre-validated inputs: ISO 8601 UTC timestamp, IANA timezone name, "HH:mm" times.
// HTTP-boundary validation is the responsibility of the route layer, not this function.
export function isInQuietHours(utcTimestamp: string, config: QuietHoursConfig): boolean {
  const { startTime, endTime, timezone } = config;

  // start == end means the window is degenerate / disabled
  if (startTime === endTime) return false;

  const local = DateTime.fromISO(utcTimestamp, { zone: 'utc' }).setZone(timezone);
  const localMinutes = local.hour * 60 + local.minute;

  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (start < end) {
    // Same-day window e.g. 09:00–17:00
    return localMinutes >= start && localMinutes < end;
  }

  // Cross-midnight window e.g. 22:00–08:00
  return localMinutes >= start || localMinutes < end;
}
