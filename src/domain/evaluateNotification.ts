import {
  NotificationType,
  Channel,
  Region,
  EvaluationResult,
  TYPE_PRIORITY,
  CHANNEL_INTERRUPTIVE,
  MANDATORY_TYPES,
} from './types';
import { isInQuietHours, QuietHoursConfig } from './quietHours';

interface QuietHoursInput extends QuietHoursConfig {
  enabled: boolean;
}

interface MatchingPolicy {
  reason: string;
}

export interface EvaluationInput {
  notificationType: NotificationType;
  channel: Channel;
  region: Region;
  timestamp: string; // ISO 8601 UTC

  defaultEnabled: boolean;
  userOverrideEnabled: boolean | null; // null = no row in UserPreferenceOverride
  quietHours: QuietHoursInput | null;  // null = user has no quiet hours configured
  matchingPolicy: MatchingPolicy | null; // non-null = a deny policy was found
}

export function evaluateNotification(input: EvaluationInput): EvaluationResult {
  const {
    notificationType,
    channel,
    timestamp,
    defaultEnabled,
    userOverrideEnabled,
    quietHours,
    matchingPolicy,
  } = input;

  // 1. Global deny policy — always wins
  if (matchingPolicy !== null) {
    return { decision: 'deny', reason: 'blocked_by_global_policy' };
  }

  // 2. Mandatory critical type — always allowed after policy check
  if (MANDATORY_TYPES.has(notificationType)) {
    return { decision: 'allow', reason: 'allowed_mandatory' };
  }

  // 3. User explicitly disabled this channel
  if (userOverrideEnabled === false) {
    return { decision: 'deny', reason: 'disabled_by_user_preference' };
  }

  // 4. No user override and default is disabled
  if (userOverrideEnabled === null && !defaultEnabled) {
    return { decision: 'deny', reason: 'disabled_by_default' };
  }

  // 5. Quiet hours — only non-critical types on interruptive channels
  if (
    quietHours !== null &&
    quietHours.enabled &&
    TYPE_PRIORITY[notificationType] !== 'critical' &&
    CHANNEL_INTERRUPTIVE[channel] &&
    isInQuietHours(timestamp, quietHours)
  ) {
    return { decision: 'deny', reason: 'blocked_by_quiet_hours' };
  }

  // 6. Allow
  return { decision: 'allow', reason: 'allowed' };
}
