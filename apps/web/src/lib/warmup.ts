export const WARMUP_START_VOLUME = 50;

export type WarmupStatus = 'not_started' | 'in_progress' | 'graduated';

/**
 * Geometric ramp from WARMUP_START_VOLUME on day 1 to target on day planDays.
 * `dayIndex` is 1-based. Returns target for that day.
 */
export function warmupTargetForDay(dayIndex: number, planDays: number, target: number): number {
  const start = Math.min(WARMUP_START_VOLUME, target);
  if (planDays <= 1) return target;
  if (dayIndex <= 1) return start;
  if (dayIndex >= planDays) return target;
  const ratio = Math.pow(target / start, (dayIndex - 1) / (planDays - 1));
  return Math.round(start * ratio);
}

export function daysElapsed(startDate: Date, now: Date = new Date()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - start) / msPerDay);
}

export interface WarmupProgress {
  status: WarmupStatus;
  dayIndex: number;         // 1-based; 0 if not started
  todayTarget: number;      // 0 if graduated/not-started
  planDays: number;
  target: number;
}

export function computeProgress(
  startDate: Date,
  planDays: number,
  target: number,
  now: Date = new Date(),
): WarmupProgress {
  const elapsed = daysElapsed(startDate, now);
  if (elapsed < 0) return { status: 'not_started', dayIndex: 0, todayTarget: 0, planDays, target };
  const dayIndex = elapsed + 1;
  if (dayIndex > planDays) return { status: 'graduated', dayIndex, todayTarget: target, planDays, target };
  return {
    status: 'in_progress',
    dayIndex,
    todayTarget: warmupTargetForDay(dayIndex, planDays, target),
    planDays,
    target,
  };
}
