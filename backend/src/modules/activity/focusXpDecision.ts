// src/modules/activity/focusXpDecision.ts — Focus XP Anti-Farming & Quality Decision Engine
// Pure deterministic business logic implementing rules R1 through R16 from Milestone M1.

export const MIN_FOCUS_DURATION_SEC = 1500; // 25 minutes
export const COMPLETION_THRESHOLD_RATIO = 0.90; // 90% of planned time required
export const HEARTBEAT_INTERVAL_SEC = 60; // 1 heartbeat expected per minute
export const MIN_HEARTBEAT_COVERAGE_RATIO = 0.70; // 70% heartbeat coverage required
export const DAILY_FOCUS_XP_CAP = 200; // Max 200 focus XP per UTC calendar day
export const STANDARD_FOCUS_SESSION_XP = 50; // Base award per qualified 25m session

export type FocusXpReason =
  | 'qualified'
  | 'below_min_duration'
  | 'below_completion_threshold'
  | 'below_heartbeat_coverage'
  | 'daily_cap_reached';

export interface FocusSessionEvaluationInput {
  plannedDurationMinutes?: number;
  plannedSec?: number;
  activeDurationMs?: number;
  activeSec?: number;
  heartbeatCount?: number;
  completedAt?: Date | string;
}

export interface FocusXpDecisionResult {
  qualified: boolean;
  xpAmount: number;
  reason: FocusXpReason;
  capApplied: boolean;
  activeSec: number;
  plannedSec: number;
  coverageRatio: number;
}

/**
 * Computes active focus duration in seconds from input fields.
 */
export function computeActiveSec(input: FocusSessionEvaluationInput): number {
  if (typeof input.activeSec === 'number' && Number.isFinite(input.activeSec)) {
    return Math.max(0, Math.floor(input.activeSec));
  }
  if (typeof input.activeDurationMs === 'number' && Number.isFinite(input.activeDurationMs)) {
    return Math.max(0, Math.floor(input.activeDurationMs / 1000));
  }
  return 0;
}

/**
 * Computes planned focus duration in seconds from input fields.
 */
export function computePlannedSec(input: FocusSessionEvaluationInput): number {
  if (typeof input.plannedSec === 'number' && Number.isFinite(input.plannedSec)) {
    return Math.max(0, Math.floor(input.plannedSec));
  }
  if (typeof input.plannedDurationMinutes === 'number' && Number.isFinite(input.plannedDurationMinutes)) {
    return Math.max(0, Math.floor(input.plannedDurationMinutes * 60));
  }
  return 0;
}

/**
 * Computes heartbeat coverage ratio against expected 60-second intervals.
 */
export function computeCoverage(activeSec: number, heartbeatCount: number = 0): number {
  const expectedHeartbeats = Math.floor(activeSec / HEARTBEAT_INTERVAL_SEC);
  if (expectedHeartbeats <= 0) {
    return 1.0;
  }
  return Math.min(1.0, Math.max(0, heartbeatCount / expectedHeartbeats));
}

/**
 * Pure decision function evaluating focus session qualification and XP award.
 *
 * Rules:
 * - R1 (Minimum Duration): plannedSec >= 1500s (25 minutes)
 * - R2 (Completion Threshold): activeSec / plannedSec >= 0.90
 * - R3 (Heartbeat Coverage): heartbeatCount / expectedHeartbeats >= 0.70
 * - R4 (Daily UTC Cap): focus XP capped at 200 XP/day. Qualified sessions past cap earn 0 XP
 *   with capApplied: true and reason: 'daily_cap_reached', but remain qualified for streaks.
 *
 * @param session Focus session metrics (durations, heartbeats)
 * @param priorFocusXpToday Total focus XP earned by the user earlier in the current UTC day
 */
export function decideFocusXp(
  session: FocusSessionEvaluationInput,
  priorFocusXpToday: number = 0
): FocusXpDecisionResult {
  const plannedSec = computePlannedSec(session);
  const activeSec = computeActiveSec(session);
  const heartbeatCount = Math.max(0, session.heartbeatCount ?? 0);
  const coverageRatio = computeCoverage(activeSec, heartbeatCount);

  // R1: Minimum planned duration must be at least 25 minutes
  if (plannedSec < MIN_FOCUS_DURATION_SEC) {
    return {
      qualified: false,
      xpAmount: 0,
      reason: 'below_min_duration',
      capApplied: false,
      activeSec,
      plannedSec,
      coverageRatio,
    };
  }

  // R2: Active focus time must achieve at least 90% of planned duration
  const completionRatio = plannedSec > 0 ? activeSec / plannedSec : 0;
  if (completionRatio < COMPLETION_THRESHOLD_RATIO) {
    return {
      qualified: false,
      xpAmount: 0,
      reason: 'below_completion_threshold',
      capApplied: false,
      activeSec,
      plannedSec,
      coverageRatio,
    };
  }

  // R3: Heartbeat coverage must be at least 70% of active 60s intervals
  if (coverageRatio < MIN_HEARTBEAT_COVERAGE_RATIO) {
    return {
      qualified: false,
      xpAmount: 0,
      reason: 'below_heartbeat_coverage',
      capApplied: false,
      activeSec,
      plannedSec,
      coverageRatio,
    };
  }

  // Session is fully qualified. Now apply Rule R4: Daily UTC Cap
  const safePriorXp = Math.max(0, Number.isFinite(priorFocusXpToday) ? priorFocusXpToday : 0);
  const remainingBudget = Math.max(0, DAILY_FOCUS_XP_CAP - safePriorXp);

  if (remainingBudget <= 0) {
    return {
      qualified: true,
      xpAmount: 0,
      reason: 'daily_cap_reached',
      capApplied: true,
      activeSec,
      plannedSec,
      coverageRatio,
    };
  }

  const awardAmount = Math.min(STANDARD_FOCUS_SESSION_XP, remainingBudget);
  const capApplied = remainingBudget < STANDARD_FOCUS_SESSION_XP;

  return {
    qualified: true,
    xpAmount: awardAmount,
    reason: 'qualified',
    capApplied,
    activeSec,
    plannedSec,
    coverageRatio,
  };
}
