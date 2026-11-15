// backend/src/__tests__/modules/activity/focus-xp-decision.test.ts
import { describe, it, expect } from 'vitest';
import {
  decideFocusXp,
  computeActiveSec,
  computePlannedSec,
  computeCoverage,
  MIN_FOCUS_DURATION_SEC,
  STANDARD_FOCUS_SESSION_XP,
  DAILY_FOCUS_XP_CAP,
} from '../../../modules/activity/focusXpDecision.js';

describe('Focus XP Decision Engine (Rules R1-R4)', () => {
  describe('Helper Functions: computePlannedSec & computeActiveSec', () => {
    it('computes planned duration in seconds from minutes or seconds', () => {
      expect(computePlannedSec({ plannedDurationMinutes: 25 })).toBe(1500);
      expect(computePlannedSec({ plannedSec: 1800 })).toBe(1800);
      expect(computePlannedSec({})).toBe(0);
    });

    it('computes active duration in seconds from milliseconds or seconds', () => {
      expect(computeActiveSec({ activeDurationMs: 1_500_000 })).toBe(1500);
      expect(computeActiveSec({ activeSec: 1400 })).toBe(1400);
      expect(computeActiveSec({})).toBe(0);
    });

    it('computes heartbeat coverage correctly', () => {
      // 1500 active sec -> 25 intervals of 60s
      expect(computeCoverage(1500, 25)).toBe(1.0);
      expect(computeCoverage(1500, 20)).toBe(0.8);
      expect(computeCoverage(1500, 15)).toBe(0.6);
      expect(computeCoverage(30, 0)).toBe(1.0); // short interval fallback
    });
  });

  describe('Rule R1: Minimum Duration Check', () => {
    it('disqualifies sessions planned for less than 25 minutes (1500 sec)', () => {
      const decision = decideFocusXp({
        plannedDurationMinutes: 20, // 1200 sec < 1500 sec
        activeDurationMs: 1200 * 1000,
        heartbeatCount: 20,
      });

      expect(decision.qualified).toBe(false);
      expect(decision.xpAmount).toBe(0);
      expect(decision.reason).toBe('below_min_duration');
      expect(decision.capApplied).toBe(false);
    });

    it('accepts sessions planned for exactly 25 minutes (1500 sec)', () => {
      const decision = decideFocusXp({
        plannedSec: MIN_FOCUS_DURATION_SEC,
        activeSec: MIN_FOCUS_DURATION_SEC,
        heartbeatCount: 25,
      });

      expect(decision.qualified).toBe(true);
      expect(decision.xpAmount).toBe(STANDARD_FOCUS_SESSION_XP);
      expect(decision.reason).toBe('qualified');
    });
  });

  describe('Rule R2: Completion Threshold (90% active)', () => {
    it('disqualifies sessions where active time is below 90% of planned duration', () => {
      // Planned: 25 min (1500s), active: 22 min (1320s = 88% < 90%)
      const decision = decideFocusXp({
        plannedDurationMinutes: 25,
        activeSec: 1320,
        heartbeatCount: 22,
      });

      expect(decision.qualified).toBe(false);
      expect(decision.xpAmount).toBe(0);
      expect(decision.reason).toBe('below_completion_threshold');
    });

    it('qualifies sessions where active time is at least 90% of planned duration', () => {
      // Planned: 25 min (1500s), active: 23 min (1380s = 92% >= 90%)
      const decision = decideFocusXp({
        plannedDurationMinutes: 25,
        activeSec: 1380,
        heartbeatCount: 23,
      });

      expect(decision.qualified).toBe(true);
      expect(decision.xpAmount).toBe(STANDARD_FOCUS_SESSION_XP);
      expect(decision.reason).toBe('qualified');
    });
  });

  describe('Rule R3: Heartbeat Coverage (70% minimum)', () => {
    it('disqualifies sessions with inadequate heartbeat coverage (< 70%)', () => {
      // 25 minutes active (expected 25 heartbeats). Heartbeats: 15 (60% < 70%)
      const decision = decideFocusXp({
        plannedDurationMinutes: 25,
        activeSec: 1500,
        heartbeatCount: 15,
      });

      expect(decision.qualified).toBe(false);
      expect(decision.xpAmount).toBe(0);
      expect(decision.reason).toBe('below_heartbeat_coverage');
      expect(decision.coverageRatio).toBe(0.6);
    });

    it('qualifies sessions with sufficient heartbeat coverage (>= 70%)', () => {
      // Expected 25 heartbeats. Heartbeats: 18 (72% >= 70%)
      const decision = decideFocusXp({
        plannedDurationMinutes: 25,
        activeSec: 1500,
        heartbeatCount: 18,
      });

      expect(decision.qualified).toBe(true);
      expect(decision.xpAmount).toBe(STANDARD_FOCUS_SESSION_XP);
      expect(decision.reason).toBe('qualified');
      expect(decision.coverageRatio).toBe(0.72);
    });
  });

  describe('Rule R4: Daily UTC Cap (200 XP maximum)', () => {
    const validSession = {
      plannedDurationMinutes: 25,
      activeSec: 1500,
      heartbeatCount: 25,
    };

    it('awards full 50 XP for sessions within the 200 XP budget', () => {
      // Session 1: 0 prior XP
      const res1 = decideFocusXp(validSession, 0);
      expect(res1.qualified).toBe(true);
      expect(res1.xpAmount).toBe(50);
      expect(res1.capApplied).toBe(false);
      expect(res1.reason).toBe('qualified');

      // Session 2: 50 prior XP
      const res2 = decideFocusXp(validSession, 50);
      expect(res2.xpAmount).toBe(50);

      // Session 3: 100 prior XP
      const res3 = decideFocusXp(validSession, 100);
      expect(res3.xpAmount).toBe(50);

      // Session 4: 150 prior XP -> reaches 200 cap
      const res4 = decideFocusXp(validSession, 150);
      expect(res4.xpAmount).toBe(50);
      expect(res4.capApplied).toBe(false);
    });

    it('awards 0 XP with capApplied: true and daily_cap_reached on 5th session', () => {
      // 5th session: 200 prior XP already earned today
      const res5 = decideFocusXp(validSession, DAILY_FOCUS_XP_CAP);

      expect(res5.qualified).toBe(true); // Still counts as qualified for streaks/missions!
      expect(res5.xpAmount).toBe(0);
      expect(res5.capApplied).toBe(true);
      expect(res5.reason).toBe('daily_cap_reached');
    });

    it('awards partial XP when nearing daily cap', () => {
      // Prior XP: 175 -> only 25 XP remaining under 200 cap
      const resPartial = decideFocusXp(validSession, 175);

      expect(resPartial.qualified).toBe(true);
      expect(resPartial.xpAmount).toBe(25);
      expect(resPartial.capApplied).toBe(true);
      expect(resPartial.reason).toBe('qualified');
    });
  });
});
