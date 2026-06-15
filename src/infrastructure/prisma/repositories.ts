import type {
  DefaultPreference,
  UserPreferenceOverride,
  UserQuietHours,
  GlobalPolicy,
  NotificationType,
  Channel,
  Region,
} from '@prisma/client';
import { prisma } from './client';

// ---------------------------------------------------------------------------
// Default preferences
// ---------------------------------------------------------------------------

export async function getDefaultPreferences(): Promise<DefaultPreference[]> {
  return prisma.defaultPreference.findMany();
}

export async function getDefaultPreference(
  notificationType: NotificationType,
  channel: Channel,
): Promise<DefaultPreference | null> {
  return prisma.defaultPreference.findUnique({
    where: { notificationType_channel: { notificationType, channel } },
  });
}

// ---------------------------------------------------------------------------
// User preference overrides
// ---------------------------------------------------------------------------

export async function getUserPreferenceOverrides(userId: string): Promise<UserPreferenceOverride[]> {
  return prisma.userPreferenceOverride.findMany({ where: { userId } });
}

export async function getUserPreferenceOverride(
  userId: string,
  notificationType: NotificationType,
  channel: Channel,
): Promise<UserPreferenceOverride | null> {
  return prisma.userPreferenceOverride.findUnique({
    where: { userId_notificationType_channel: { userId, notificationType, channel } },
  });
}

interface PreferenceUpdate {
  notificationType: NotificationType;
  channel: Channel;
  enabled: boolean;
}

// Merge-upsert: only touches the provided pairs, never wipes other overrides.
// Idempotent: repeated calls with the same payload leave state unchanged.
export async function upsertUserPreferenceOverrides(
  userId: string,
  preferences: PreferenceUpdate[],
): Promise<void> {
  await prisma.$transaction(
    preferences.map((p) =>
      prisma.userPreferenceOverride.upsert({
        where: {
          userId_notificationType_channel: {
            userId,
            notificationType: p.notificationType,
            channel: p.channel,
          },
        },
        create: { userId, notificationType: p.notificationType, channel: p.channel, enabled: p.enabled },
        update: { enabled: p.enabled },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

export async function getUserQuietHours(userId: string): Promise<UserQuietHours | null> {
  return prisma.userQuietHours.findUnique({ where: { userId } });
}

interface QuietHoursData {
  enabled: boolean;
  startTime: string;
  endTime: string;
  timezone: string;
}

export async function upsertUserQuietHours(
  userId: string,
  data: QuietHoursData,
): Promise<UserQuietHours> {
  return prisma.userQuietHours.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

// ---------------------------------------------------------------------------
// Global policies
// ---------------------------------------------------------------------------

// Returns the most-specific matching deny policy: region-specific > GLOBAL > null.
// A single query fetches both candidates; the caller receives whichever applies.
export async function findMatchingGlobalPolicy(
  notificationType: NotificationType,
  channel: Channel,
  region: Region,
): Promise<GlobalPolicy | null> {
  const candidates = await prisma.globalPolicy.findMany({
    where: {
      notificationType,
      channel,
      region: { in: [region, 'GLOBAL'] },
    },
  });

  return (
    candidates.find((p) => p.region === region) ??
    candidates.find((p) => p.region === 'GLOBAL') ??
    null
  );
}
