export interface ScheduledJob {
  name: string;
  intervalMs: number;
  task: () => Promise<void> | void;
  runOnStart?: boolean;
}

const handles: NodeJS.Timeout[] = [];

export function scheduleJob(job: ScheduledJob): NodeJS.Timeout {
  console.log(`[scheduler] registering "${job.name}" every ${job.intervalMs}ms`);
  const run = async () => {
    try {
      await job.task();
    } catch (e) {
      console.error(`[scheduler] job "${job.name}" failed`, e);
    }
  };
  if (job.runOnStart) void run();
  const handle = setInterval(run, job.intervalMs);
  handles.push(handle);
  return handle;
}

export function stopAll() {
  for (const h of handles) clearInterval(h);
  handles.length = 0;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Runs `task` once per day at the given UTC hour (0-23). First run is the next future occurrence. */
export function scheduleDailyUtc(name: string, utcHour: number, task: () => Promise<void> | void): void {
  const run = async () => {
    try { await task(); } catch (e) { console.error(`[scheduler] daily "${name}" failed`, e); }
  };
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    utcHour, 0, 0, 0,
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  console.log(`[scheduler] daily "${name}" first run in ${Math.round(delay / 60000)}m (at ${next.toISOString()})`);
  setTimeout(() => {
    void run();
    const handle = setInterval(run, DAY);
    handles.push(handle);
  }, delay);
}
