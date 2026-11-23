import { normalizeTimeZoneName, type ServerTimeZoneInfo } from '@conai/shared';

/**
 * The app time zone (settings › 시스템 › 시간대) applied to the whole process through `process.env.TZ`: Node re-reads
 * it on assignment, so every later local-time read (file names, date folders, chat minutes, backup names, the
 * wallpaper schedule tool) and the processes this one starts follow it without a restart. Values already written
 * keep their time; SQLite timestamps stay UTC. '' keeps the zone the server started in.
 */

const startEnvTimeZone = process.env.TZ;
/** The zone the process started in, read before the setting can change it. */
const startTimeZone = processTimeZone();
let applied: string | null = null;

function processTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function restoreStartTimeZone() {
  if (startEnvTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = startEnvTimeZone;
  // Windows Node keeps the last zone after TZ is removed; naming the start zone puts it back.
  if (processTimeZone() !== startTimeZone && normalizeTimeZoneName(startTimeZone)) process.env.TZ = startTimeZone;
}

/** The zone the server runs in without the setting. */
export function serverTimeZone(): string {
  return startTimeZone;
}

/** Apply the saved setting; returns the zone the process now uses. An invalid value keeps the server's zone. */
export function applyAppTimeZone(setting: unknown): string {
  const zone = normalizeTimeZoneName(setting);
  if (zone === applied) return processTimeZone();
  // The server's own zone needs no override (so started processes inherit the environment unchanged).
  if (!zone || zone === normalizeTimeZoneName(startTimeZone)) restoreStartTimeZone();
  else process.env.TZ = zone;
  const now = processTimeZone();
  if (applied !== null || zone) console.log(`🕒 Time zone: ${now}${zone ? '' : ' (server)'}`);
  if (zone && now !== zone) console.warn(`[AppTimeZone] Asked for ${zone}, the runtime reports ${now}`);
  applied = zone;
  return now;
}

export function getServerTimeZoneInfo(now: Date = new Date()): ServerTimeZoneInfo {
  return { serverTimeZone: startTimeZone, timeZone: processTimeZone(), now: now.toISOString() };
}
