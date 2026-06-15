export type NotificationType = 'marketing' | 'transactional' | 'security' | 'system';

export type Channel = 'email' | 'sms' | 'push' | 'messenger';

export type Region = 'EU' | 'US' | 'RU' | 'GLOBAL';

export type Priority = 'critical' | 'normal' | 'low';

export const TYPE_PRIORITY: Record<NotificationType, Priority> = {
  security:      'critical',
  transactional: 'critical',
  system:        'normal',
  marketing:     'low',
};

export const CHANNEL_INTERRUPTIVE: Record<Channel, boolean> = {
  email:     false,
  sms:       true,
  push:      true,
  messenger: true,
};

export const MANDATORY_TYPES: ReadonlySet<NotificationType> = new Set(['security', 'transactional']);

export type DecisionReason =
  | 'allowed'
  | 'allowed_mandatory'
  | 'blocked_by_global_policy'
  | 'disabled_by_user_preference'
  | 'disabled_by_default'
  | 'blocked_by_quiet_hours';

export type Decision = 'allow' | 'deny';

export interface EvaluationResult {
  decision: Decision;
  reason: DecisionReason;
}
