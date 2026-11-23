/**
 * Stored media file names: the patterns of settings › 미디어 처리 › 파일 이름, their validation, rendering and the
 * name cleanup. The backend allocator and the settings preview share this code, so a preview shows what a save writes.
 *
 * Tokens: `{name}` · `{yyyy}` `{MM}` `{dd}` `{HH}` `{mm}` `{ss}` (the app time zone, see timeZone.ts) · `{n}` / `{n:digits}` (sequence from 1)
 * · `{rand}` (6 random characters) · `{engine}` (novelai / comfyui / codex / upload / conai).
 * The extension is never part of a pattern: the saved format decides it.
 */

import type { FileNamingSettings } from '../types/settings';
import { zonedDateParts } from './timeZone';

export type FileNamePatternRole = 'upload' | 'generated' | 'collision';

export const DEFAULT_FILE_NAMING_SETTINGS: Readonly<FileNamingSettings> = Object.freeze({
  upload: '{name}',
  generated: '{yyyy}_{MM}_{dd}_{HH}{mm}{ss}_{rand}',
  collision: '{name}_{n:3}',
});

export const FILE_NAMING_LIMITS = Object.freeze({
  /** Characters of one pattern as typed. */
  patternLength: 100,
  /** Characters and UTF-8 bytes of a stored name without its extension (ext4 allows 255 bytes per name). */
  stemLength: 120,
  stemBytes: 200,
  /** `{n:digits}` padding. */
  maxDigits: 9,
});

/** `{engine}` for a stored file that no generation engine produced. */
export const FILE_NAME_ENGINE_UPLOAD = 'upload';
export const FILE_NAME_ENGINE_INTERNAL = 'conai';

export type FileNameTokenName = 'name' | 'yyyy' | 'MM' | 'dd' | 'HH' | 'mm' | 'ss' | 'n' | 'rand' | 'engine';

/** The token chips of the settings editor, in display order, as inserted text. */
export const FILE_NAME_TOKEN_CHIPS: readonly string[] = ['{name}', '{yyyy}', '{MM}', '{dd}', '{HH}', '{mm}', '{ss}', '{n:3}', '{rand}', '{engine}'];

export interface FileNamingPreset {
  id: string;
  label: { ko: string; en: string };
  pattern: string;
}

export const FILE_NAMING_PRESETS: Readonly<Record<FileNamePatternRole, readonly FileNamingPreset[]>> = {
  upload: [
    { id: 'original', label: { ko: '원본명', en: 'Original name' }, pattern: '{name}' },
    { id: 'date-first', label: { ko: '날짜 앞', en: 'Date first' }, pattern: '{yyyy}{MM}{dd}_{HH}{mm}{ss}_{name}' },
    { id: 'date-last', label: { ko: '날짜 뒤', en: 'Date last' }, pattern: '{name}_{yyyy}{MM}{dd}_{HH}{mm}{ss}' },
    { id: 'legacy', label: { ko: '예전 방식', en: 'Previous format' }, pattern: '{yyyy}{MM}{dd}_{HH}{mm}{ss}_{rand}_{name}' },
  ],
  generated: [
    { id: 'date-random', label: { ko: '날짜 + 랜덤', en: 'Date + random' }, pattern: '{yyyy}_{MM}_{dd}_{HH}{mm}{ss}_{rand}' },
    { id: 'date-sequence', label: { ko: '날짜 + 순번', en: 'Date + number' }, pattern: '{yyyy}{MM}{dd}_{n:3}' },
    { id: 'engine-date', label: { ko: '엔진 + 날짜', en: 'Engine + date' }, pattern: '{engine}_{yyyy}{MM}{dd}_{HH}{mm}{ss}' },
  ],
  collision: [
    { id: 'number-after', label: { ko: '_001 뒤에', en: '_001 after' }, pattern: '{name}_{n:3}' },
    { id: 'date-before', label: { ko: '날짜·시간 앞에', en: 'Date and time before' }, pattern: '{yyyy}{MM}{dd}_{HH}{mm}{ss}_{name}' },
    { id: 'date-after', label: { ko: '날짜·시간 뒤에', en: 'Date and time after' }, pattern: '{name}_{yyyy}{MM}{dd}_{HH}{mm}{ss}' },
  ],
};

type FileNamePart = { kind: 'text'; value: string } | { kind: 'token'; token: FileNameTokenName; digits: number };

export type FileNamePatternIssue =
  | { code: 'empty' }
  | { code: 'too-long'; max: number }
  | { code: 'unbalanced-brace' }
  | { code: 'unknown-token'; token: string }
  | { code: 'invalid-digits'; token: string }
  | { code: 'invalid-character'; character: string }
  | { code: 'name-not-allowed' }
  | { code: 'name-required' };

const TOKEN_NAMES: ReadonlySet<string> = new Set<FileNameTokenName>(['name', 'yyyy', 'MM', 'dd', 'HH', 'mm', 'ss', 'n', 'rand', 'engine']);
// Windows-forbidden characters plus control characters; the same set the stored names are cleaned of.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTER = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\.|$)/i;
const MEDIA_EXTENSION = /\.(png|jpe?g|jfif|webp|gif|apng|avif|bmp|tiff?|heic|heif|jxl|mp4|m4v|webm|mov|mkv|avi)$/i;

type ParsedPattern = { ok: true; parts: FileNamePart[] } | { ok: false; issue: FileNamePatternIssue };

function parsePattern(pattern: string): ParsedPattern {
  const parts: FileNamePart[] = [];
  let text = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '}') return { ok: false, issue: { code: 'unbalanced-brace' } };
    if (character !== '{') {
      text += character;
      continue;
    }
    const end = pattern.indexOf('}', index + 1);
    const nextOpen = pattern.indexOf('{', index + 1);
    if (end === -1 || (nextOpen !== -1 && nextOpen < end)) return { ok: false, issue: { code: 'unbalanced-brace' } };
    const body = pattern.slice(index + 1, end);
    const [name, digitsText, ...extra] = body.split(':');
    if (!TOKEN_NAMES.has(name)) return { ok: false, issue: { code: 'unknown-token', token: `{${body}}` } };
    let digits = 1;
    if (digitsText !== undefined || extra.length) {
      const parsed = Number(digitsText);
      if (name !== 'n' || extra.length || !/^\d+$/.test(digitsText ?? '') || parsed < 1 || parsed > FILE_NAMING_LIMITS.maxDigits) {
        return { ok: false, issue: { code: 'invalid-digits', token: `{${body}}` } };
      }
      digits = parsed;
    }
    if (text) parts.push({ kind: 'text', value: text });
    text = '';
    parts.push({ kind: 'token', token: name as FileNameTokenName, digits });
    index = end;
  }
  if (text) parts.push({ kind: 'text', value: text });
  return { ok: true, parts };
}

function hasToken(parts: readonly FileNamePart[], token: FileNameTokenName) {
  return parts.some((part) => part.kind === 'token' && part.token === token);
}

/** The first problem of a pattern for its role, or null when it can be saved. */
export function validateFileNamePattern(pattern: unknown, role: FileNamePatternRole): FileNamePatternIssue | null {
  if (typeof pattern !== 'string' || !pattern.trim()) return { code: 'empty' };
  if (pattern.length > FILE_NAMING_LIMITS.patternLength) return { code: 'too-long', max: FILE_NAMING_LIMITS.patternLength };
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return parsed.issue;
  for (const part of parsed.parts) {
    const match = part.kind === 'text' ? FORBIDDEN_CHARACTER.exec(part.value) : null;
    if (match) return { code: 'invalid-character', character: match[0] };
  }
  if (role === 'generated' && hasToken(parsed.parts, 'name')) return { code: 'name-not-allowed' };
  if (role === 'collision' && !hasToken(parsed.parts, 'name')) return { code: 'name-required' };
  if (!parsed.parts.some((part) => part.kind === 'token') && !sanitizeFileNameStem(pattern)) return { code: 'empty' };
  return null;
}

/** The message for a pattern problem, in both UI languages (the server answers in English). */
export function describeFileNamePatternIssue(issue: FileNamePatternIssue): { ko: string; en: string } {
  switch (issue.code) {
    case 'empty': return { ko: '패턴을 입력해.', en: 'Enter a pattern.' };
    case 'too-long': return { ko: `${issue.max}자까지 쓸 수 있어.`, en: `Use at most ${issue.max} characters.` };
    case 'unbalanced-brace': return { ko: '중괄호 { } 짝이 맞지 않아.', en: 'The braces { } do not pair up.' };
    case 'unknown-token': return { ko: `${issue.token}는 없는 값이야.`, en: `${issue.token} is not a known value.` };
    case 'invalid-digits': return { ko: `${issue.token}: 자릿수는 {n:1}부터 {n:${FILE_NAMING_LIMITS.maxDigits}}까지야.`, en: `${issue.token}: digits run from {n:1} to {n:${FILE_NAMING_LIMITS.maxDigits}}.` };
    case 'invalid-character': return { ko: `파일 이름에 쓸 수 없는 문자야: ${JSON.stringify(issue.character)}`, en: `Not allowed in a file name: ${JSON.stringify(issue.character)}` };
    case 'name-not-allowed': return { ko: '생성물에는 {name}을 쓸 수 없어.', en: 'Generated files have no {name}.' };
    case 'name-required': return { ko: '{name}이 들어가야 해.', en: 'Include {name}.' };
  }
}

/** Saved settings with every missing or invalid pattern replaced by its default. */
export function normalizeFileNamingSettings(raw: unknown): FileNamingSettings {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const pick = (role: FileNamePatternRole) => {
    const value = record[role];
    return typeof value === 'string' && validateFileNamePattern(value, role) === null ? value : DEFAULT_FILE_NAMING_SETTINGS[role];
  };
  return { upload: pick('upload'), generated: pick('generated'), collision: pick('collision') };
}

function fitStem(stem: string, maxLength: number, maxBytes: number) {
  const characters = Array.from(stem);
  if (characters.length > maxLength) characters.length = maxLength;
  let result = characters.join('');
  while (characters.length && utf8Length(result) > maxBytes) {
    characters.pop();
    result = characters.join('');
  }
  return result;
}

function utf8Length(value: string) {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * A name without extension that every supported file system stores as written: control and forbidden characters
 * become `_`, leading and trailing dots/spaces go, a Windows device name (CON, NUL, COM1…) gets `_`, and the result
 * fits the length limits. Can return an empty string; callers pick their own fallback.
 */
export function sanitizeFileNameStem(value: string, limits: { maxLength?: number; maxBytes?: number } = {}): string {
  const maxLength = limits.maxLength ?? FILE_NAMING_LIMITS.stemLength;
  const maxBytes = limits.maxBytes ?? FILE_NAMING_LIMITS.stemBytes;
  const trim = (text: string) => text.replace(/^[\s.]+/u, '').replace(/[\s.]+$/u, '');
  let stem = trim(value.normalize('NFC').replace(FORBIDDEN_CHARACTERS, '_'));
  stem = stem.replace(RESERVED_DEVICE_NAME, '$1_');
  return trim(fitStem(stem, maxLength, maxBytes));
}

/** A name someone typed for a result: a media extension written at its end is dropped (the format decides it). */
export function stripMediaExtension(value: string): string {
  let result = value.trim();
  while (MEDIA_EXTENSION.test(result)) result = result.replace(MEDIA_EXTENSION, '').trimEnd();
  return result;
}

/** `{name}` of an uploaded file: its base name without the extension (path parts never reach the stored name). */
export function uploadNameStem(originalName: string): string {
  const base = originalName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface FileNameValues {
  name?: string;
  date: Date;
  /** IANA zone the date tokens are read in; without one, this runtime's local zone (the server's app time zone). */
  timeZone?: string;
  n?: number;
  rand?: string;
  engine?: string;
}

function renderParts(parts: readonly FileNamePart[], values: FileNameValues, name: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = zonedDateParts(values.date, values.timeZone);
  return parts.map((part) => {
    if (part.kind === 'text') return part.value;
    switch (part.token) {
      case 'name': return name;
      case 'yyyy': return String(clock.year);
      case 'MM': return pad(clock.month);
      case 'dd': return pad(clock.day);
      case 'HH': return pad(clock.hour);
      case 'mm': return pad(clock.minute);
      case 'ss': return pad(clock.second);
      case 'n': return String(values.n ?? 1).padStart(part.digits, '0');
      case 'rand': return values.rand ?? randomFileNameSuffix();
      case 'engine': return values.engine ?? FILE_NAME_ENGINE_INTERNAL;
    }
  }).join('');
}

/**
 * Render a pattern to a clean stem within the length limits. A long `{name}` is shortened first, so the parts the
 * pattern adds (a sequence number, a date) survive the limit. Throws on an invalid pattern.
 */
export function renderFileNameStem(pattern: string, values: FileNameValues): string {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) throw new Error(`Invalid file name pattern: ${pattern}`);
  let name = values.name ?? '';
  for (;;) {
    const stem = sanitizeFileNameStem(renderParts(parsed.parts, values, name), { maxLength: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER });
    const fitted = sanitizeFileNameStem(stem);
    if (fitted === stem || !name || !hasToken(parsed.parts, 'name')) return fitted;
    const overflow = Math.max(Array.from(stem).length - FILE_NAMING_LIMITS.stemLength, Math.ceil((utf8Length(stem) - FILE_NAMING_LIMITS.stemBytes) / 3), 1);
    const characters = Array.from(name);
    name = characters.slice(0, Math.max(0, characters.length - overflow)).join('');
  }
}

export function randomFileNameSuffix(): string {
  let suffix = '';
  while (suffix.length < 6) suffix += Math.random().toString(36).slice(2);
  return suffix.slice(0, 6);
}

export interface FileNameCandidateRequest {
  settings: FileNamingSettings;
  /**
   * `upload`: named by the upload pattern from `originalName`; `generated`: the generated pattern or `requestedName`;
   * `keep`: `keepName` exactly as it is (a restored file), then the collision pattern on its stem.
   */
  kind: 'upload' | 'generated' | 'keep';
  /** `keep`: the file name with its extension. */
  keepName?: string;
  /** The uploaded file's name (`{name}` is its base name without the extension). */
  originalName?: string;
  /** A name the user typed for a generated result; replaces the generated pattern. */
  requestedName?: string;
  /** Saved format's extension, with or without the dot. */
  extension: string;
  engine?: string;
  date?: Date;
  rand?: string;
}

/** The name a generation request asked for, cleaned, or '' for none. */
export function cleanRequestedFileName(value: unknown): string {
  return typeof value === 'string' ? sanitizeFileNameStem(stripMediaExtension(value)) : '';
}

/**
 * The stored names to try in order, until one is free in the target folder. With `{n}` in the first pattern: its
 * lowest free number. Without: the first name, then the collision pattern on it, and when that pattern has no `{n}`,
 * the collision pattern with `_{n:3}` added. Never ends; the caller stops at the first free name.
 */
export function* fileNameCandidates(request: FileNameCandidateRequest): Generator<string, never, undefined> {
  const settings = normalizeFileNamingSettings(request.settings);
  const kept = request.kind === 'keep' ? (request.keepName ?? '').split(/[\\/]/).pop() ?? '' : '';
  const keptStem = kept ? uploadNameStem(kept) : '';
  const extension = kept ? kept.slice(keptStem.length).replace(/^\./, '') : request.extension.replace(/^\./, '').toLowerCase();
  const suffix = extension ? `.${extension}` : '';
  const values: FileNameValues = { date: request.date ?? new Date(), rand: request.rand ?? randomFileNameSuffix(), engine: request.engine };
  const requested = request.kind === 'generated' ? cleanRequestedFileName(request.requestedName) : '';
  const uploadName = request.kind === 'upload' ? sanitizeFileNameStem(uploadNameStem(request.originalName ?? '')) || 'file' : undefined;
  const fallback = (stem: string) => stem || 'file';
  let first: string;
  if (kept) {
    // An existing name is tried as it is; only the collision names are built and cleaned.
    yield kept;
    first = sanitizeFileNameStem(keptStem) || 'file';
  } else if (requested) {
    first = requested;
  } else {
    const pattern = request.kind === 'upload' ? settings.upload : settings.generated;
    if (hasToken((parsePattern(pattern) as { parts: FileNamePart[] }).parts, 'n')) {
      for (let n = 1; ; n += 1) yield fallback(renderFileNameStem(pattern, { ...values, name: uploadName, n })) + suffix;
    }
    first = fallback(renderFileNameStem(pattern, { ...values, name: uploadName }));
  }
  if (!kept) yield first + suffix;
  const collision = settings.collision;
  if (!hasToken((parsePattern(collision) as { parts: FileNamePart[] }).parts, 'n')) {
    yield fallback(renderFileNameStem(collision, { ...values, name: first })) + suffix;
  }
  const numbered = hasToken((parsePattern(collision) as { parts: FileNamePart[] }).parts, 'n') ? collision : `${collision}_{n:3}`;
  for (let n = 1; ; n += 1) yield fallback(renderFileNameStem(numbered, { ...values, name: first, n })) + suffix;
}

/**
 * Example names for the settings preview of one pattern (two for a collision pattern). `timeZone`: the server's app
 * time zone, so the browser shows the date and time a save would write.
 */
export function previewFileNamePattern(pattern: string, role: FileNamePatternRole, sample: { date?: Date; extension?: string; timeZone?: string } = {}): string[] {
  if (validateFileNamePattern(pattern, role)) return [];
  const date = sample.date ?? new Date();
  const extension = `.${sample.extension ?? 'png'}`;
  const values: FileNameValues = { date, timeZone: sample.timeZone || undefined, rand: 'k3f9x2', engine: 'novelai' };
  if (role === 'collision') {
    const numbered = hasToken((parsePattern(pattern) as { parts: FileNamePart[] }).parts, 'n');
    const names = [renderFileNameStem(pattern, { ...values, name: 'cat', n: 1 })];
    if (numbered) names.push(renderFileNameStem(pattern, { ...values, name: 'cat', n: 2 }));
    return names.map((stem) => (stem || 'file') + extension);
  }
  return [(renderFileNameStem(pattern, { ...values, name: role === 'upload' ? 'cat' : undefined, n: 1 }) || 'file') + extension];
}
