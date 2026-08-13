import path from 'path';
import fg from 'fast-glob';
import { ALL_SUPPORTED_EXTENSIONS, shouldProcessFileExtension } from '../../constants/supportedExtensions';
import { normalizeWindowsDriveLetter } from '../../utils/pathResolver';
import { EXCLUDE_PATTERN_CASE_SENSITIVE, normalizeExcludeGlobPatterns } from './excludePatternUtils';

const isVerboseScanDebugEnabled = process.env.CONAI_VERBOSE_SCAN_DEBUG === 'true';

// fast-glob 의 readdir 호출은 libuv 스레드풀을 거친다. 동시성을 스레드풀 크기보다
// 크게 잡으면 대기열이 스캔 작업으로만 채워져, 같은 풀을 쓰는 HTTP 파일 응답이
// 스캔이 끝날 때까지 밀린다. 스레드풀(기본 16, 런처가 주입)과 균형을 맞춘다.
function resolveScanGlobConcurrency(): number {
  const parsed = Number.parseInt(process.env.CONAI_SCAN_GLOB_CONCURRENCY ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, 256);
  }
  return 16;
}
const SCAN_GLOB_CONCURRENCY = resolveScanGlobConcurrency();

/**
 * 파일 검색 및 수집 서비스
 */
export class FileDiscoveryService {
  /**
   * 파일 수집 (재귀적) - fast-glob 사용으로 최적화
   */
  static async collectFiles(
    dirPath: string,
    options: {
      recursive: boolean;
      excludeExtensions: string[];
      excludePatterns: string[] | null;
    }
  ): Promise<string[]> {
    // Windows 경로를 Unix 스타일로 정규화 (fast-glob 호환성)
    const normalizedPath = dirPath.replace(/\\/g, '/');

    // 지원하는 확장자로 fast-glob 패턴 생성 (성능 최적화)
    // 패턴/ignore 모두 스캔 루트(cwd) 기준 상대 경로를 사용한다. 절대 경로 패턴을
    // 쓰면 `**/{name}/**` 형태의 제외 패턴이 루트 위쪽 경로 요소까지 매칭해
    // (예: 루트가 D:/Photos/temp, 제외 패턴이 "temp") 스캔 결과가 통째로 사라진다.
    const exts = ALL_SUPPORTED_EXTENSIONS
      .map(ext => ext.startsWith('.') ? ext.substring(1) : ext)
      .join(',');
    const patterns = options.recursive
      ? [`**/*.{${exts}}`]
      : [`*.{${exts}}`];

    if (isVerboseScanDebugEnabled) {
      console.log(`Fast-glob 패턴:`, patterns);
      console.log(`지원 확장자:`, ALL_SUPPORTED_EXTENSIONS);
      console.log(`제외 확장자:`, options.excludeExtensions);
      console.log(`제외 패턴:`, options.excludePatterns);
    }

    try {
      // Step 1: 지원하는 확장자 파일 모두 스캔
      // 제외 패턴의 bare name은 스캔 루트 기준 **/{name}/** 형태로 정규화
      const allFiles = await fg(patterns, {
        cwd: normalizedPath,
        ignore: normalizeExcludeGlobPatterns(options.excludePatterns, normalizedPath),
        absolute: true,
        onlyFiles: true,
        concurrency: SCAN_GLOB_CONCURRENCY,
        // chokidar matcher와 동일한 대소문자 규칙을 공유 (excludePatternUtils 참고)
        caseSensitiveMatch: EXCLUDE_PATTERN_CASE_SENSITIVE,
        // A full rescan uses this list as the authority for missing-file
        // reconciliation. Suppressing traversal errors would turn a partial
        // directory listing into a successful empty scan and hide valid media.
        suppressErrors: false
      });

      if (isVerboseScanDebugEnabled) {
        console.log(`Fast-glob 결과: ${allFiles.length}개 파일 발견`);
      }

      // Step 2: 제외 확장자 필터링 + Windows 드라이브 문자 정규화 + 유니코드 정규화
      const { normalizePath } = require('../../utils/pathResolver');
      const filteredFiles = allFiles
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return shouldProcessFileExtension(ext, options.excludeExtensions);
        })
        .map(file => normalizeWindowsDriveLetter(file)) // Windows 드라이브 문자를 대문자로 통일
        .map(file => normalizePath(file)); // 유니코드 정규화 (NFC) 적용

      if (isVerboseScanDebugEnabled && filteredFiles.length < allFiles.length) {
        console.log(`제외 필터 적용: ${allFiles.length} -> ${filteredFiles.length}개 파일`);
      }

      if (isVerboseScanDebugEnabled && filteredFiles.length > 0) {
        console.log(`처음 3개 파일:`, filteredFiles.slice(0, 3));
      }

      return filteredFiles;
    } catch (error) {
      console.error(`파일 스캔 실패: ${dirPath}`, error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`파일 탐색을 완료하지 못했습니다: ${dirPath} (${message})`);
    }
  }

  /**
   * MIME 타입 추정
   */
  static getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.gif': 'image/gif'  // GIF는 animated 타입으로 분류됨
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
