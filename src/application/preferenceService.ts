import type { NotificationType, Channel, Region } from '@prisma/client';
import {
  getDefaultPreferences,
  getDefaultPreference,
  getUserPreferenceOverrides,
  getUserPreferenceOverride,
  upsertUserPreferenceOverrides,
  getUserQuietHours,
  upsertUserQuietHours,
  findMatchingGlobalPolicy,
} from '../infrastructure/prisma/repositories';
import { evaluateNotification } from '../domain/evaluateNotification';
import type { EvaluationResult } from '../domain/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EffectivePreference {
  notificationType: NotificationType;
  channel: Channel;
  enabled: boolean;
  source: 'default' | 'override';
}

export interface PreferenceUpdateItem {
  notificationType: NotificationType;
  channel: Channel;
  enabled: boolean;
}

export interface QuietHoursInput {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface UpdatePayload {
  preferences?: PreferenceUpdateItem[];
  quietHours?: QuietHoursInput;
}

export interface EvaluateInput {
  userId: string;
  notificationType: NotificationType;
  channel: Channel;
  region: Region;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function getUserPreferences(userId: string): Promise<EffectivePreference[]> {
  const [defaults, overrides] = await Promise.all([
    getDefaultPreferences(),
    getUserPreferenceOverrides(userId),
  ]);

  const overrideMap = new Map(
    overrides.map((o) => [`${o.notificationType}:${o.channel}`, o]),
  );

  return defaults.map((d) => {
    const override = overrideMap.get(`${d.notificationType}:${d.channel}`);
    if (override) {
      return { notificationType: d.notificationType, channel: d.channel, enabled: override.enabled, source: 'override' as const };
    }
    return { notificationType: d.notificationType, channel: d.channel, enabled: d.enabled, source: 'default' as const };
  });
}

export async function updateUserPreferences(userId: string, payload: UpdatePayload): Promise<void> {
  if (payload.preferences && payload.preferences.length > 0) {
    await Promise.all(
      payload.preferences.map(async (p) => {
        const supported = await getDefaultPreference(p.notificationType, p.channel);
        if (!supported) {
          throw new Error(`Unsupported combination: ${p.notificationType}/${p.channel}`);
        }
      }),
    );
    await upsertUserPreferenceOverrides(userId, payload.preferences);
  }

  if (payload.quietHours) {
    await upsertUserQuietHours(userId, payload.quietHours);
  }
}

export async function evaluateForUser(input: EvaluateInput): Promise<EvaluationResult> {
  const { userId, notificationType, channel, region, timestamp } = input;

  const defaultPref = await getDefaultPreference(notificationType, channel);
  if (!defaultPref) {
    throw new Error(`Unsupported combination: ${notificationType}/${channel}`);
  }

  const [override, quietHours, matchingPolicy] = await Promise.all([
    getUserPreferenceOverride(userId, notificationType, channel),
    getUserQuietHours(userId),
    findMatchingGlobalPolicy(notificationType, channel, region),
  ]);

  return evaluateNotification({
    notificationType,
    channel,
    region,
    timestamp,
    defaultEnabled: defaultPref.enabled,
    userOverrideEnabled: override?.enabled ?? null,
    quietHours: quietHours
      ? { enabled: quietHours.enabled, startTime: quietHours.startTime, endTime: quietHours.endTime, timezone: quietHours.timezone }
      : null,
    matchingPolicy: matchingPolicy ? { reason: matchingPolicy.reason } : null,
  });
}
