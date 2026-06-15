import { describe, it, expect } from 'vitest';
import { evaluateNotification, EvaluationInput } from '../evaluateNotification';

// Base: marketing push, everything enabled, no special conditions
const base: EvaluationInput = {
  notificationType: 'marketing',
  channel: 'push',
  region: 'US',
  timestamp: '2026-01-15T12:00:00Z',
  defaultEnabled: true,
  userOverrideEnabled: null,
  quietHours: null,
  matchingPolicy: null,
};

const crossMidnightQuietHours = {
  enabled: true,
  startTime: '22:00',
  endTime: '08:00',
  timezone: 'Europe/London',
};

describe('evaluateNotification', () => {
  describe('rule 1 — global deny policy', () => {
    it('denies when a matching policy exists', () => {
      expect(evaluateNotification({ ...base, matchingPolicy: { reason: 'marketing_banned_EU' } }))
        .toEqual({ decision: 'deny', reason: 'blocked_by_global_policy' });
    });

    it('policy overrides even a mandatory type', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'security',
        matchingPolicy: { reason: 'security_sms_banned' },
      })).toEqual({ decision: 'deny', reason: 'blocked_by_global_policy' });
    });
  });

  describe('rule 2 — mandatory critical type', () => {
    it('allows security regardless of user override and defaults', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'security',
        defaultEnabled: false,
        userOverrideEnabled: false,
      })).toEqual({ decision: 'allow', reason: 'allowed_mandatory' });
    });

    it('allows transactional regardless of user override', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'transactional',
        userOverrideEnabled: false,
      })).toEqual({ decision: 'allow', reason: 'allowed_mandatory' });
    });
  });

  describe('rule 3 — user override disabled', () => {
    it('denies when user explicitly disabled the type/channel', () => {
      expect(evaluateNotification({ ...base, userOverrideEnabled: false }))
        .toEqual({ decision: 'deny', reason: 'disabled_by_user_preference' });
    });
  });

  describe('rule 4 — default disabled', () => {
    it('denies when no override exists and default is disabled', () => {
      expect(evaluateNotification({ ...base, defaultEnabled: false, userOverrideEnabled: null }))
        .toEqual({ decision: 'deny', reason: 'disabled_by_default' });
    });

    it('allows when user override is true even if default is disabled', () => {
      expect(evaluateNotification({ ...base, defaultEnabled: false, userOverrideEnabled: true }))
        .toEqual({ decision: 'allow', reason: 'allowed' });
    });
  });

  describe('rule 5 — quiet hours', () => {
    it('blocks marketing push during quiet hours', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'marketing',
        channel: 'push',
        timestamp: '2026-01-15T23:00:00Z', // 23:00 London → inside 22:00–08:00
        quietHours: crossMidnightQuietHours,
      })).toEqual({ decision: 'deny', reason: 'blocked_by_quiet_hours' });
    });

    it('does not block marketing email during quiet hours (email is not interruptive)', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'marketing',
        channel: 'email',
        timestamp: '2026-01-15T23:00:00Z',
        quietHours: crossMidnightQuietHours,
      })).toEqual({ decision: 'allow', reason: 'allowed' });
    });

    it('does not block security push during quiet hours (critical priority)', () => {
      expect(evaluateNotification({
        ...base,
        notificationType: 'security',
        channel: 'sms',
        timestamp: '2026-01-15T23:00:00Z',
        quietHours: crossMidnightQuietHours,
      })).toEqual({ decision: 'allow', reason: 'allowed_mandatory' });
    });

    it('blocks in the early-morning part of a cross-midnight window', () => {
      expect(evaluateNotification({
        ...base,
        timestamp: '2026-01-15T07:30:00Z', // 07:30 London → inside 22:00–08:00
        quietHours: crossMidnightQuietHours,
      })).toEqual({ decision: 'deny', reason: 'blocked_by_quiet_hours' });
    });

    it('allows at the exclusive end of the quiet hours window (08:00)', () => {
      expect(evaluateNotification({
        ...base,
        timestamp: '2026-01-15T08:00:00Z', // 08:00 London → outside
        quietHours: crossMidnightQuietHours,
      })).toEqual({ decision: 'allow', reason: 'allowed' });
    });

    it('does not block when quiet hours start equals end (degenerate window)', () => {
      expect(evaluateNotification({
        ...base,
        timestamp: '2026-01-15T23:00:00Z',
        quietHours: { enabled: true, startTime: '22:00', endTime: '22:00', timezone: 'Europe/London' },
      })).toEqual({ decision: 'allow', reason: 'allowed' });
    });

    it('does not block when quiet hours are disabled', () => {
      expect(evaluateNotification({
        ...base,
        timestamp: '2026-01-15T23:00:00Z',
        quietHours: { ...crossMidnightQuietHours, enabled: false },
      })).toEqual({ decision: 'allow', reason: 'allowed' });
    });
  });

  describe('rule 6 — allow', () => {
    it('allows when no conditions trigger a denial', () => {
      expect(evaluateNotification(base)).toEqual({ decision: 'allow', reason: 'allowed' });
    });
  });

  describe('determinism', () => {
    it('returns identical result for the same input called twice', () => {
      expect(evaluateNotification(base)).toEqual(evaluateNotification(base));
    });

    it('returns identical result for the same input during quiet hours called twice', () => {
      const input: EvaluationInput = {
        ...base,
        timestamp: '2026-01-15T23:00:00Z',
        quietHours: crossMidnightQuietHours,
      };
      expect(evaluateNotification(input)).toEqual(evaluateNotification(input));
    });
  });
});
