/**
 * The app's time zone (settings › 시스템): IANA names only. The server applies the saved name process-wide, so file
 * names, date folders and other server clocks read it; the settings page renders server times with these helpers.
 */

/** Every zone this runtime offers, plus `UTC` (Intl lists only the regional names). */
export function listTimeZoneNames(): string[] {
  // ES2022 API; this package compiles against ES2020 typings.
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const supported = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  return supported.includes('UTC') ? [...supported] : ['UTC', ...supported];
}

let knownZones: ReadonlySet<string> | null = null;

/**
 * The canonical IANA name for `value`, or '' for an empty, unknown or offset-style value ('+09:00', 'EST5EDT'). A
 * differently cased or aliased name comes back as the runtime's canonical spelling ('asia/seoul' → 'Asia/Seoul'),
 * which every tz database also knows.
 */
export function normalizeTimeZoneName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || name.length > 64 || name !== value) return '';
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return '';
  }
  if (canonical === 'UTC') return 'UTC';
  knownZones ??= new Set(listTimeZoneNames());
  // Without a list (an old runtime) only region/city names pass; offsets and POSIX rules never do.
  if (knownZones.size > 1 ? knownZones.has(canonical) : /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(canonical)) return canonical;
  return '';
}

export interface ZonedDateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The calendar date and wall-clock time `date` shows in `timeZone`; without one, in this runtime's local zone. */
export function zonedDateParts(date: Date, timeZone?: string): ZonedDateParts {
  if (!timeZone) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** `UTC+09:00`, `UTC−03:30` or `UTC` for how far `timeZone` is from UTC at `date`. */
export function timeZoneOffsetLabel(timeZone: string, date: Date = new Date()): string {
  const local = zonedDateParts(date, timeZone);
  const minutes = Math.round((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  if (minutes === 0) return 'UTC';
  const pad = (value: number) => String(value).padStart(2, '0');
  const absolute = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
