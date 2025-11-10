import path from 'path';
import fg from 'fast-glob';
import { ALL_SUPPORTED_EXTENSIONS, shouldProcessFileExtension } from '../../constants/supportedExtensions';
import { normalizeWindowsDriveLetter } from '../../utils/pathResolver';

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
    const exts = ALL_SUPPORTED_EXTENSIONS
      .map(ext => ext.startsWith('.') ? ext.substring(1) : ext)
      .join(',');
    const patterns = options.recursive
      ? [`${normalizedPath}/**/*.{${exts}}`]
      : [`${normalizedPath}/*.{${exts}}`];

    console.log(`Fast-glob 패턴:`, patterns);
    console.log(`지원 확장자:`, ALL_SUPPORTED_EXTENSIONS);
    console.log(`제외 확장자:`, options.excludeExtensions);
    console.log(`제외 패턴:`, options.excludePatterns);

    try {
      // Step 1: 지원하는 확장자 파일 모두 스캔
      const allFiles = await fg(patterns, {
        ignore: options.excludePatterns || [],
        absolute: true,
        onlyFiles: true,
        concurrency: 256,
        caseSensitiveMatch: false,
        suppressErrors: true  // 권한 문제 등의 에러 무시
      });

      console.log(`Fast-glob 결과: ${allFiles.length}개 파일 발견`);

      // Step 2: 제외 확장자 필터링 + Windows 드라이브 문자 정규화 + 유니코드 정규화
      const { normalizePath } = require('../../utils/pathResolver');
      const filteredFiles = allFiles
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return shouldProcessFileExtension(ext, options.excludeExtensions);
        })
        .map(file => normalizeWindowsDriveLetter(file)) // Windows 드라이브 문자를 대문자로 통일
        .map(file => normalizePath(file)); // 유니코드 정규화 (NFC) 적용

      if (filteredFiles.length < allFiles.length) {
        console.log(`제외 필터 적용: ${allFiles.length} -> ${filteredFiles.length}개 파일`);
      }

      if (filteredFiles.length > 0) {
        console.log(`처음 3개 파일:`, filteredFiles.slice(0, 3));
      }

      return filteredFiles;
    } catch (error) {
      console.error(`파일 스캔 실패: ${dirPath}`, error);
      return [];
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