/**
 * Shared exclude-pattern normalization for folder scans and file watchers.
 *
 * Watched-folder exclude_patterns are usually bare directory/file names
 * (e.g. "@eaDir"). Bare names never match the paths handed to fast-glob
 * `ignore` as-is, and chokidar compares string matchers with exact equality,
 * so both consumers need the patterns adapted first.
 *
 * 두 소비자 모두 "스캔/감시 루트 기준 상대 경로"에만 패턴을 적용한다.
 * 절대 경로 전체에 매칭하면 루트나 그 조상 디렉토리 이름이 패턴과 겹칠 때
 * (예: 감시 폴더가 D:\Photos\temp 이고 제외 패턴이 "temp") 루트 자체가
 * 제외되어 fast-glob 결과가 0건이 되고 chokidar 워처도 조용히 멈춘다.
 */

import path from 'path';

/**
 * 제외 패턴은 두 소비자가 동일하게 대소문자를 구분하지 않는다.
 * fast-glob에는 `caseSensitiveMatch`로, chokidar matcher에는 정규식 `i` 플래그로
 * 같은 규칙을 적용한다. 한쪽만 바꾸면 동작이 어긋나므로 이 상수를 통해 묶어 둔다.
 */
export const EXCLUDE_PATTERN_CASE_SENSITIVE: boolean = false;

function toSlashPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * 루트 기준 상대 경로. 루트 자신이거나 루트 바깥이면 null.
 * (chokidar는 감시 루트 자체도 ignored 판정에 넘기므로 반드시 걸러야 한다)
 */
function toRootRelativePath(resolvedRoot: string, candidatePath: string): string | null {
  const relative = path.relative(resolvedRoot, path.resolve(candidatePath));

  if (
    relative.length === 0
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    return null;
  }

  return toSlashPath(relative);
}

/** Convert one root-relative glob pattern to a RegExp over forward-slash paths. */
function globPatternToRegExp(pattern: string): RegExp {
  let regex = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // globstar: `**/`는 0개 이상의 디렉토리, 끝의 `**`는 나머지 전체
        if (pattern[i + 2] === '/') {
          regex += '(?:[^/]+/)*';
          i += 2;
        } else {
          regex += '.*';
          i += 1;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  const flags = EXCLUDE_PATTERN_CASE_SENSITIVE ? '' : 'i';
  return new RegExp(`^${regex}$`, flags);
}

/**
 * 제외 패턴 하나를 스캔 루트 기준 상대 패턴으로 변환
 * - 절대 경로: 루트 기준으로 다시 고정, 루트 밖을 가리키면 null
 * - 경로 구분자를 포함한 상대 패턴: 루트 기준 그대로 사용
 * - 단일 이름/글롭("@eaDir", "thumb*"): 트리 어디에 있든 걸리도록 globstar 접두
 */
function toRootRelativeBasePattern(resolvedRoot: string, pattern: string): string | null {
  if (path.isAbsolute(pattern)) {
    return toRootRelativePath(resolvedRoot, pattern);
  }

  const slashed = toSlashPath(pattern);
  return slashed.includes('/') ? slashed : `**/${slashed}`;
}

/**
 * Normalize exclude patterns into root-relative fast-glob `ignore` patterns.
 * Bare names match at any depth, absolute patterns are re-anchored to the scan
 * root (and dropped when they point outside it), and every pattern also gets a
 * trailing-globstar form so an excluded directory takes its whole subtree.
 *
 * 호출부는 fast-glob `cwd`를 같은 루트로 지정해야 한다. 그래야 globstar 제외
 * 패턴이 루트 위쪽 경로 요소까지 훑지 못한다.
 */
export function normalizeExcludeGlobPatterns(
  patterns: string[] | null | undefined,
  rootPath: string
): string[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }

  const resolvedRoot = path.resolve(rootPath);
  const normalized: string[] = [];

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const basePattern = toRootRelativeBasePattern(resolvedRoot, trimmed);
    if (!basePattern) {
      continue;
    }

    normalized.push(basePattern);
    if (!basePattern.endsWith('/**')) {
      // 디렉토리 이름이 걸리면 그 하위 전체도 제외
      normalized.push(`${basePattern}/**`);
    }
  }

  return normalized;
}

/**
 * Build a chokidar MatchFunction for the same exclude patterns.
 * fast-glob과 동일한 정규화 결과를 재사용해 두 소비자의 판정이 갈리지 않게 한다.
 * 감시 루트 자신과 루트 바깥 경로는 항상 제외 대상이 아니다.
 */
export function createExcludePatternMatcher(
  patterns: string[] | null | undefined,
  rootPath: string
): ((candidatePath: string) => boolean) | undefined {
  const normalizedPatterns = normalizeExcludeGlobPatterns(patterns, rootPath);
  if (normalizedPatterns.length === 0) {
    return undefined;
  }

  const resolvedRoot = path.resolve(rootPath);
  const globRegexps = normalizedPatterns.map(globPatternToRegExp);

  return (candidatePath: string): boolean => {
    const relativePath = toRootRelativePath(resolvedRoot, candidatePath);
    if (relativePath === null) {
      return false;
    }

    return globRegexps.some((regex) => regex.test(relativePath));
  };
}
