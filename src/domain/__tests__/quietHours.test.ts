import { describe, it, expect } from 'vitest';
import { isInQuietHours } from '../quietHours';

// All timestamps use Europe/London in January (UTC+0, no DST) so local == UTC.
const TZ = 'Europe/London';

describe('isInQuietHours', () => {
  describe('same-day window', () => {
    it('returns true when local time is inside range', () => {
      expect(isInQuietHours('2026-01-15T13:00:00Z', { startTime: '09:00', endTime: '17:00', timezone: TZ })).toBe(true);
    });

    it('returns false when local time is outside range', () => {
      expect(isInQuietHours('2026-01-15T18:00:00Z', { startTime: '09:00', endTime: '17:00', timezone: TZ })).toBe(false);
    });

    it('treats start as inclusive', () => {
      expect(isInQuietHours('2026-01-15T09:00:00Z', { startTime: '09:00', endTime: '17:00', timezone: TZ })).toBe(true);
    });

    it('treats end as exclusive', () => {
      expect(isInQuietHours('2026-01-15T17:00:00Z', { startTime: '09:00', endTime: '17:00', timezone: TZ })).toBe(false);
    });
  });

  describe('cross-midnight window (22:00–08:00)', () => {
    it('returns true in the evening portion (after start)', () => {
      expect(isInQuietHours('2026-01-15T23:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: TZ })).toBe(true);
    });

    it('returns true in the early-morning portion (before end)', () => {
      expect(isInQuietHours('2026-01-15T07:30:00Z', { startTime: '22:00', endTime: '08:00', timezone: TZ })).toBe(true);
    });

    it('treats start as inclusive (exactly 22:00)', () => {
      expect(isInQuietHours('2026-01-15T22:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: TZ })).toBe(true);
    });

    it('treats end as exclusive (exactly 08:00)', () => {
      expect(isInQuietHours('2026-01-15T08:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: TZ })).toBe(false);
    });

    it('returns false in the middle of the day (between end and start)', () => {
      expect(isInQuietHours('2026-01-15T12:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: TZ })).toBe(false);
    });
  });

  describe('edge case: start == end', () => {
    it('returns false regardless of timestamp', () => {
      expect(isInQuietHours('2026-01-15T22:00:00Z', { startTime: '22:00', endTime: '22:00', timezone: TZ })).toBe(false);
    });
  });

  describe('timezone conversion', () => {
    // Europe/Moscow is UTC+3 in January
    it('converts UTC timestamp to local time before comparing (inside window)', () => {
      // 20:00 UTC = 23:00 Moscow → inside 22:00–08:00
      expect(isInQuietHours('2026-01-15T20:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: 'Europe/Moscow' })).toBe(true);
    });

    it('converts UTC timestamp to local time before comparing (outside window)', () => {
      // 12:00 UTC = 15:00 Moscow → outside 22:00–08:00
      expect(isInQuietHours('2026-01-15T12:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: 'Europe/Moscow' })).toBe(false);
    });
  });

  describe('DST handling (Europe/Berlin)', () => {
    // Winter: UTC+1 (CET). 21:00 UTC = 22:00 Berlin → inside 22:00–08:00
    it('applies winter offset (UTC+1) correctly', () => {
      expect(isInQuietHours('2026-01-15T21:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: 'Europe/Berlin' })).toBe(true);
    });

    // Summer: UTC+2 (CEST). 20:00 UTC = 22:00 Berlin → inside 22:00–08:00
    // Same wall-clock time requires an earlier UTC timestamp than in winter.
    it('applies summer offset (UTC+2) correctly', () => {
      expect(isInQuietHours('2026-06-15T20:00:00Z', { startTime: '22:00', endTime: '08:00', timezone: 'Europe/Berlin' })).toBe(true);
    });
  });
});
