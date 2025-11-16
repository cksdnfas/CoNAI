import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 유니코드 문자열을 NFC(Canonical Composition) 형식으로 정규화
 *
 * macOS는 NFD(분해형), Windows/Linux는 NFC(결합형)을 사용하므로
 * NFC로 통일하여 크로스 플랫폼 호환성 보장
 *
 * @param str 정규화할 문자열
 * @returns NFC 형식으로 정규화된 문자열
 *
 * @example
 * // macOS NFD: "한글" = "\u1112\u1161\u11AB\u1100\u1173\u11AF"
 * // Windows NFC: "한글" = "\uD55C\uAE00"
 * normalizeUnicode("한글") // -> NFC 형식으로 통일
 */
export function normalizeUnicode(str: string): string {
  return str.normalize('NFC');
}

/**
 * 파일명을 유니코드 정규화 및 안전하게 처리
 *
 * @param filename 원본 파일명
 * @returns 정규화되고 안전한 파일명
 */
export function normalizeFilename(filename: string): string {
  // 유니코드 정규화 (NFC)
  let normalized = normalizeUnicode(filename);

  // 파일 시스템에서 금지된 문자 제거/대체
  // Windows: < > : " / \ | ? *
  // 단, 확장자 구분자인 마지막 . 는 유지
  const lastDotIndex = normalized.lastIndexOf('.');
  const nameWithoutExt = lastDotIndex > 0 ? normalized.substring(0, lastDotIndex) : normalized;
  const ext = lastDotIndex > 0 ? normalized.substring(lastDotIndex) : '';

  // 금지 문자를 언더스코어로 대체
  const safeName = nameWithoutExt.replace(/[<>:"/\\|?*]/g, '_');

  return safeName + ext;
}

/**
 * 경로를 정규화 (Windows/Unix 호환 + 유니코드 정규화)
 *
 * @param pathStr 경로 문자열
 * @param forceUnix Unix 스타일 슬래시 강제 (fast-glob 등)
 * @returns 정규화된 경로
 */
export function normalizePath(pathStr: string, forceUnix: boolean = false): string {
  // 유니코드 정규화 먼저 적용
  const unicodeNormalized = normalizeUnicode(pathStr);
  const normalized = path.normalize(unicodeNormalized);
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
 * - UNC 경로 (\\server\share 또는 //server/share): 절대 경로로 처리
 * - 상대 경로: basePath 기준으로 해석 (포터블 이동 시 자동 적용)
 *
 * @param folderPath 폴더 경로 (절대, UNC, 또는 상대)
 * @returns 절대 경로
 */
export function resolveFolderPath(folderPath: string): string {
  // Windows UNC 경로는 절대 경로로 처리 (\\server\share 또는 //server/share)
  const isUNC = folderPath.startsWith('\\\\') || folderPath.startsWith('//');

  // 이미 절대 경로이거나 UNC 경로면 그대로 반환
  if (path.isAbsolute(folderPath) || isUNC) {
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
