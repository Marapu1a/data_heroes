import { z } from 'zod';
import { IANAZone, DateTime } from 'luxon';

export const NotificationTypeSchema = z.enum(['marketing', 'transactional', 'security', 'system']);
export const ChannelSchema = z.enum(['email', 'sms', 'push', 'messenger']);
export const RegionSchema = z.enum(['EU', 'US', 'RU', 'GLOBAL']);

const HHMMSchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  'Must be HH:mm in 24-hour format (e.g. 22:00)',
);

const TimezoneSchema = z.string().refine(
  (tz) => IANAZone.isValidZone(tz),
  { message: 'Must be a valid IANA timezone (e.g. Europe/Moscow)' },
);

const TimestampSchema = z.string().refine(
  (ts) => {
    const dt = DateTime.fromISO(ts, { zone: 'utc' });
    return dt.isValid && ts.endsWith('Z');
  },
  { message: 'Must be a valid UTC ISO 8601 timestamp ending with Z (e.g. 2026-01-15T23:00:00Z)' },
);

export const UserParamsSchema = z.object({
  id: z.string().min(1),
});

export const UpdatePreferencesBodySchema = z.object({
  preferences: z
    .array(
      z.object({
        notificationType: NotificationTypeSchema,
        channel: ChannelSchema,
        enabled: z.boolean(),
      }),
    )
    .optional(),
  quietHours: z
    .object({
      enabled: z.boolean(),
      startTime: HHMMSchema,
      endTime: HHMMSchema,
      timezone: TimezoneSchema,
    })
    .optional(),
});

export const EvaluateBodySchema = z.object({
  userId: z.string().min(1),
  notificationType: NotificationTypeSchema,
  channel: ChannelSchema,
  region: RegionSchema,
  timestamp: TimestampSchema,
});
