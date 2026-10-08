/**
 * Export file names for a sound group, ported from the SFX manager (`sfx/naming.py`).
 *
 * A group's label is its file-name rule: `footstep_snow_[00]` numbers each selected file into the `[00]` slot (1–8
 * zeros set the padding, even for a single file); without a slot one file keeps the label and several files count on
 * from a trailing `_<digits>` or get `_01`, `_02`, ... appended.
 */

const TOKEN = /\[(0{1,8})\]/;
const TOKEN_GLOBAL = /\[(0{1,8})\]/g;
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export class AudioLabelError extends Error {
  readonly status = 400;
}

/** Python's str.strip() without arguments: Unicode whitespace on both ends. */
function strip(value: string): string {
  return value.replace(/^\s+|\s+$/gu, '');
}

/** Returns the trimmed label, or throws AudioLabelError with the original app's message. */
export function validateAudioLabel(input: string): string {
  const value = strip(String(input ?? ''));
  if (!value || [...value].length > 120 || FORBIDDEN.test(value)) {
    throw new AudioLabelError('라벨은 1~120자이며 파일명에 사용할 수 없는 문자를 포함할 수 없습니다.');
  }
  const stripped = value.replace(TOKEN_GLOBAL, '1');
  if (stripped.includes('[') || stripped.includes(']') || (value.match(TOKEN_GLOBAL)?.length ?? 0) > 1) {
    throw new AudioLabelError('순번은 [00] 또는 [000]처럼 0을 1~8개 넣은 자리 하나로 지정해 주세요.');
  }
  if (stripped.endsWith('.') || stripped.endsWith(' ') || stripped === '.' || stripped === '..' || stripped.toLowerCase().endsWith('.wav')) {
    throw new AudioLabelError('라벨에는 확장자 .wav나 끝의 점·공백을 넣지 마세요.');
  }
  if (RESERVED.test(stripped)) {
    throw new AudioLabelError('운영체제 예약 파일명은 라벨로 사용할 수 없습니다.');
  }
  return value;
}

/** File name of the `index`-th (1-based) of `count` selected files of a group with this label. */
export function audioExportFileName(label: string, index: number, count: number, format = 'wav'): string {
  const value = validateAudioLabel(label);
  let stem: string;
  if (TOKEN.test(value)) {
    stem = value.replace(TOKEN, (_match, zeros: string) => String(index).padStart(zeros.length, '0'));
  } else if (count === 1) {
    stem = value;
  } else {
    const suffix = /^(.*_)(\d+)$/s.exec(value);
    stem = suffix
      ? suffix[1] + String(Number.parseInt(suffix[2], 10) + index - 1).padStart(suffix[2].length, '0')
      : `${value}_${String(index).padStart(2, '0')}`;
  }
  return `${stem}.${format}`;
}
