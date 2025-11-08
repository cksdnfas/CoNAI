import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 경로를 정규화 (Windows/Unix 호환)
 *
 * @param pathStr 경로 문자열
 * @param forceUnix Unix 스타일 슬래시 강제 (fast-glob 등)
 * @returns 정규화된 경로
 */
export function normalizePath(pathStr: string, forceUnix: boolean = false): string {
  const normalized = path.normalize(pathStr);
  return forceUnix ? normalized.replace(/\\/g, '/') : normalized;
}

/**
 * Windows 경로의 드라이브 문자를 대문자로 정규화
 * fast-glob이 반환하는 경로의 드라이브 문자 대소문자 불일치 문제 해결
 *
 * @param filePath 파일 경로
 * @returns 드라이브 문자가 대문자로 정규화된 경로
 *
 * @example
 * normalizeWindowsDriveLetter('d:\\_Dev\\file.txt') // 'D:\\_Dev\\file.txt'
 * normalizeWindowsDriveLetter('D:\\_Dev\\file.txt') // 'D:\\_Dev\\file.txt'
 * normalizeWindowsDriveLetter('/unix/path') // '/unix/path'
 */
export function normalizeWindowsDriveLetter(filePath: string): string {
  // Windows 드라이브 문자 패턴 (예: d:\ 또는 d:/)
  const driveLetterPattern = /^([a-z]):([\\/])/i;
  const match = filePath.match(driveLetterPattern);

  if (match) {
    // 드라이브 문자를 대문자로 변환
    return filePath.replace(driveLetterPattern, (_, letter, slash) =>
      `${letter.toUpperCase()}:${slash}`
    );
  }

  // Windows 경로가 아니면 그대로 반환
  return filePath;
}

/**
 * 폴더 경로를 해석하여 절대 경로로 변환
 *
 * - 절대 경로: 그대로 반환
 * - 상대 경로: basePath 기준으로 해석 (포터블 이동 시 자동 적용)
 *
 * @param folderPath 폴더 경로 (절대 또는 상대)
 * @returns 절대 경로
 */
export function resolveFolderPath(folderPath: string): string {
  // 이미 절대 경로면 그대로 반환
  if (path.isAbsolute(folderPath)) {
    return path.normalize(folderPath);
  }

  // 상대 경로는 basePath 기준으로 해석
  // 포터블을 이동해도 basePath가 자동으로 변경되므로 경로가 자동 적용됨
  return path.resolve(runtimePaths.basePath, folderPath);
}

/**
 * 절대 경로를 상대 경로로 변환 (가능한 경우)
 *
 * @param absolutePath 절대 경로
 * @returns basePath 기준 상대 경로 또는 원본 절대 경로
 */
export function toRelativePath(absolutePath: string): string {
  // basePath 하위 경로인지 확인
  const normalized = path.normalize(absolutePath);
  const baseNormalized = path.normalize(runtimePaths.basePath);

  if (normalized.startsWith(baseNormalized)) {
    // basePath 기준 상대 경로로 변환
    return path.relative(baseNormalized, normalized);
  }

  // basePath 외부 경로는 절대 경로 유지
  return absolutePath;
}
