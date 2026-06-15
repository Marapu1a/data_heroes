import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../infrastructure/prisma/repositories', () => ({
  getDefaultPreferences: vi.fn(),
  getDefaultPreference: vi.fn(),
  getUserPreferenceOverrides: vi.fn(),
  getUserPreferenceOverride: vi.fn(),
  upsertUserPreferenceOverrides: vi.fn(),
  getUserQuietHours: vi.fn(),
  upsertUserQuietHours: vi.fn(),
  findMatchingGlobalPolicy: vi.fn(),
}));

import * as repos from '../../infrastructure/prisma/repositories';
import { getUserPreferences, updateUserPreferences, evaluateForUser } from '../preferenceService';

// Helpers to reduce boilerplate in mock setup
const defaultPref = (notificationType: string, channel: string, enabled: boolean) =>
  ({ notificationType, channel, enabled }) as ReturnType<typeof repos.getDefaultPreference> extends Promise<infer T> ? NonNullable<T> : never;

const overridePref = (userId: string, notificationType: string, channel: string, enabled: boolean) =>
  ({ userId, notificationType, channel, enabled, updatedAt: new Date() }) as any;

const quietHours = (userId: string, enabled: boolean) =>
  ({ userId, enabled, startTime: '22:00', endTime: '08:00', timezone: 'Europe/London', updatedAt: new Date() }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getUserPreferences
// ---------------------------------------------------------------------------

describe('getUserPreferences', () => {
  it('returns all defaults with source=default when no overrides exist', async () => {
    vi.mocked(repos.getDefaultPreferences).mockResolvedValue([
      defaultPref('marketing', 'email', false),
      defaultPref('transactional', 'email', true),
    ]);
    vi.mocked(repos.getUserPreferenceOverrides).mockResolvedValue([]);

    const result = await getUserPreferences('user-1');

    expect(result).toEqual([
      { notificationType: 'marketing', channel: 'email', enabled: false, source: 'default' },
      { notificationType: 'transactional', channel: 'email', enabled: true, source: 'default' },
    ]);
  });

  it('replaces default enabled value with override value', async () => {
    vi.mocked(repos.getDefaultPreferences).mockResolvedValue([
      defaultPref('marketing', 'email', false),
    ]);
    vi.mocked(repos.getUserPreferenceOverrides).mockResolvedValue([
      overridePref('user-1', 'marketing', 'email', true),
    ]);

    const result = await getUserPreferences('user-1');

    expect(result).toEqual([
      { notificationType: 'marketing', channel: 'email', enabled: true, source: 'override' },
    ]);
  });

  it('sets source=override only for overridden pairs, source=default for the rest', async () => {
    vi.mocked(repos.getDefaultPreferences).mockResolvedValue([
      defaultPref('marketing', 'email', false),
      defaultPref('transactional', 'email', true),
    ]);
    vi.mocked(repos.getUserPreferenceOverrides).mockResolvedValue([
      overridePref('user-1', 'marketing', 'email', true),
    ]);

    const result = await getUserPreferences('user-1');

    expect(result.find((r) => r.notificationType === 'marketing')?.source).toBe('override');
    expect(result.find((r) => r.notificationType === 'transactional')?.source).toBe('default');
  });

  it('fetches defaults and overrides in parallel (both are called)', async () => {
    vi.mocked(repos.getDefaultPreferences).mockResolvedValue([]);
    vi.mocked(repos.getUserPreferenceOverrides).mockResolvedValue([]);

    await getUserPreferences('user-1');

    expect(repos.getDefaultPreferences).toHaveBeenCalledOnce();
    expect(repos.getUserPreferenceOverrides).toHaveBeenCalledWith('user-1');
  });
});

// ---------------------------------------------------------------------------
// updateUserPreferences
// ---------------------------------------------------------------------------

describe('updateUserPreferences', () => {
  it('calls upsert when all pairs are valid', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('marketing', 'email', false));
    vi.mocked(repos.upsertUserPreferenceOverrides).mockResolvedValue(undefined as any);

    await updateUserPreferences('user-1', {
      preferences: [{ notificationType: 'marketing', channel: 'email', enabled: true }],
    });

    expect(repos.upsertUserPreferenceOverrides).toHaveBeenCalledWith('user-1', [
      { notificationType: 'marketing', channel: 'email', enabled: true },
    ]);
  });

  it('throws for an unsupported notificationType/channel pair', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(null);

    await expect(
      updateUserPreferences('user-1', {
        preferences: [{ notificationType: 'marketing', channel: 'sms', enabled: true }],
      }),
    ).rejects.toThrow('Unsupported combination: marketing/sms');
  });

  it('upserts quiet hours when included in payload', async () => {
    vi.mocked(repos.upsertUserQuietHours).mockResolvedValue(quietHours('user-1', true) as any);

    await updateUserPreferences('user-1', {
      quietHours: { enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'Europe/London' },
    });

    expect(repos.upsertUserQuietHours).toHaveBeenCalledWith('user-1', {
      enabled: true, startTime: '22:00', endTime: '08:00', timezone: 'Europe/London',
    });
  });

  it('skips upsert when preferences array is empty', async () => {
    await updateUserPreferences('user-1', { preferences: [] });

    expect(repos.upsertUserPreferenceOverrides).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// evaluateForUser
// ---------------------------------------------------------------------------

describe('evaluateForUser', () => {
  it('throws for an unsupported notificationType/channel combination', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(null);

    await expect(
      evaluateForUser({ userId: 'u1', notificationType: 'marketing', channel: 'sms', region: 'US', timestamp: '2026-01-15T12:00:00Z' }),
    ).rejects.toThrow('Unsupported combination: marketing/sms');
  });

  it('returns allow when default is enabled and no conditions block', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('marketing', 'push', true));
    vi.mocked(repos.getUserPreferenceOverride).mockResolvedValue(null);
    vi.mocked(repos.getUserQuietHours).mockResolvedValue(null);
    vi.mocked(repos.findMatchingGlobalPolicy).mockResolvedValue(null);

    const result = await evaluateForUser({
      userId: 'u1', notificationType: 'marketing', channel: 'push', region: 'US', timestamp: '2026-01-15T12:00:00Z',
    });

    expect(result).toEqual({ decision: 'allow', reason: 'allowed' });
  });

  it('returns deny/disabled_by_default when default is disabled and no override', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('marketing', 'push', false));
    vi.mocked(repos.getUserPreferenceOverride).mockResolvedValue(null);
    vi.mocked(repos.getUserQuietHours).mockResolvedValue(null);
    vi.mocked(repos.findMatchingGlobalPolicy).mockResolvedValue(null);

    const result = await evaluateForUser({
      userId: 'u1', notificationType: 'marketing', channel: 'push', region: 'US', timestamp: '2026-01-15T12:00:00Z',
    });

    expect(result).toEqual({ decision: 'deny', reason: 'disabled_by_default' });
  });

  it('passes quiet hours to evaluator and returns blocked_by_quiet_hours', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('marketing', 'push', true));
    vi.mocked(repos.getUserPreferenceOverride).mockResolvedValue(null);
    vi.mocked(repos.getUserQuietHours).mockResolvedValue(quietHours('u1', true));
    vi.mocked(repos.findMatchingGlobalPolicy).mockResolvedValue(null);

    // 23:00 UTC = 23:00 London (UTC+0 in January) → inside 22:00–08:00
    const result = await evaluateForUser({
      userId: 'u1', notificationType: 'marketing', channel: 'push', region: 'US', timestamp: '2026-01-15T23:00:00Z',
    });

    expect(result).toEqual({ decision: 'deny', reason: 'blocked_by_quiet_hours' });
  });

  it('passes matching global policy to evaluator and returns blocked_by_global_policy', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('marketing', 'sms', true));
    vi.mocked(repos.getUserPreferenceOverride).mockResolvedValue(null);
    vi.mocked(repos.getUserQuietHours).mockResolvedValue(null);
    vi.mocked(repos.findMatchingGlobalPolicy).mockResolvedValue(
      { notificationType: 'marketing', channel: 'sms', region: 'EU', reason: 'marketing_sms_banned_EU' } as any,
    );

    const result = await evaluateForUser({
      userId: 'u1', notificationType: 'marketing', channel: 'sms', region: 'EU', timestamp: '2026-01-15T12:00:00Z',
    });

    expect(result).toEqual({ decision: 'deny', reason: 'blocked_by_global_policy' });
  });

  it('returns allow_mandatory for security even when user override is disabled', async () => {
    vi.mocked(repos.getDefaultPreference).mockResolvedValue(defaultPref('security', 'sms', true));
    vi.mocked(repos.getUserPreferenceOverride).mockResolvedValue(
      overridePref('u1', 'security', 'sms', false),
    );
    vi.mocked(repos.getUserQuietHours).mockResolvedValue(quietHours('u1', true));
    vi.mocked(repos.findMatchingGlobalPolicy).mockResolvedValue(null);

    const result = await evaluateForUser({
      userId: 'u1', notificationType: 'security', channel: 'sms', region: 'US', timestamp: '2026-01-15T23:00:00Z',
    });

    expect(result).toEqual({ decision: 'allow', reason: 'allowed_mandatory' });
  });
});
