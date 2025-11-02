import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 파일 시스템 정리 스크립트
 *
 * 작업 내용:
 * 1. Origin 폴더의 모든 파일을 상위 폴더로 이동
 * 2. Origin, thumbnails 폴더 삭제
 * 3. temp 폴더 완전 정리
 * 4. 이미지와 비디오 모두 처리
 */

interface CleanupResult {
  movedFiles: number;
  deletedDirs: number;
  errors: Array<{ path: string; error: string }>;
}

export class FileSystemCleanup {
  /**
   * 전체 정리 실행
   */
  static async cleanup(): Promise<CleanupResult> {
    const result: CleanupResult = {
      movedFiles: 0,
      deletedDirs: 0,
      errors: []
    };

    console.log('🧹 파일 시스템 정리 시작...\n');

    try {
      // 1. images 폴더 정리
      await this.cleanupMediaFolder(
        path.join(runtimePaths.uploadsDir, 'images'),
        result
      );

      // 2. videos 폴더 정리
      await this.cleanupMediaFolder(
        path.join(runtimePaths.uploadsDir, 'videos'),
        result
      );

      // 3. temp 폴더 완전 삭제
      await this.cleanupTempFolder(result);

      console.log('\n✅ 파일 시스템 정리 완료');
      console.log(`  📁 이동된 파일: ${result.movedFiles}개`);
      console.log(`  🗑️  삭제된 폴더: ${result.deletedDirs}개`);
      console.log(`  ❌ 오류: ${result.errors.length}개`);

      if (result.errors.length > 0) {
        console.log('\n⚠️  오류 상세:');
        result.errors.slice(0, 10).forEach(err => {
          console.log(`  - ${err.path}: ${err.error}`);
        });
      }

      return result;
    } catch (error) {
      console.error('❌ 파일 시스템 정리 실패:', error);
      throw error;
    }
  }

  /**
   * 미디어 폴더 정리 (images 또는 videos)
   */
  private static async cleanupMediaFolder(
    mediaPath: string,
    result: CleanupResult
  ): Promise<void> {
    if (!fs.existsSync(mediaPath)) {
      console.log(`⚠️  폴더가 존재하지 않습니다: ${mediaPath}`);
      return;
    }

    console.log(`📂 정리 중: ${path.basename(mediaPath)}/`);

    const dateFolders = fs.readdirSync(mediaPath).filter(item => {
      const fullPath = path.join(mediaPath, item);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const dateFolder of dateFolders) {
      const datePath = path.join(mediaPath, dateFolder);
      await this.cleanupDateFolder(datePath, result);
    }
  }

  /**
   * 날짜별 폴더 정리 (YYYY-MM-DD)
   */
  private static async cleanupDateFolder(
    datePath: string,
    result: CleanupResult
  ): Promise<void> {
    try {
      // Origin 폴더 처리
      const originPath = path.join(datePath, 'Origin');
      if (fs.existsSync(originPath)) {
        await this.moveOriginFiles(originPath, datePath, result);

        // Origin 폴더 삭제
        if (this.isDirectoryEmpty(originPath)) {
          fs.rmdirSync(originPath);
          result.deletedDirs++;
          console.log(`  ✅ Origin 폴더 삭제: ${path.basename(datePath)}/Origin`);
        }
      }

      // thumbnails 폴더 삭제
      const thumbnailsPath = path.join(datePath, 'thumbnails');
      if (fs.existsSync(thumbnailsPath)) {
        this.deleteDirectoryRecursive(thumbnailsPath);
        result.deletedDirs++;
        console.log(`  ✅ thumbnails 폴더 삭제: ${path.basename(datePath)}/thumbnails`);
      }
    } catch (error) {
      result.errors.push({
        path: datePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      console.error(`  ❌ 날짜 폴더 정리 실패: ${path.basename(datePath)}`, error);
    }
  }

  /**
   * Origin 폴더의 파일들을 상위 폴더로 이동
   */
  private static async moveOriginFiles(
    originPath: string,
    targetPath: string,
    result: CleanupResult
  ): Promise<void> {
    const files = fs.readdirSync(originPath);

    for (const file of files) {
      try {
        const sourcePath = path.join(originPath, file);
        const destPath = path.join(targetPath, file);

        // 파일인 경우에만 이동
        const stats = fs.statSync(sourcePath);
        if (!stats.isFile()) {
          continue;
        }

        // 대상 경로에 이미 파일이 있는 경우 건너뛰기
        if (fs.existsSync(destPath)) {
          console.log(`  ⚠️  파일이 이미 존재합니다, 건너뜀: ${file}`);
          continue;
        }

        // 파일 이동
        fs.renameSync(sourcePath, destPath);
        result.movedFiles++;
      } catch (error) {
        result.errors.push({
          path: path.join(originPath, file),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error(`  ❌ 파일 이동 실패: ${file}`, error);
      }
    }
  }

  /**
   * temp 폴더 완전 삭제
   */
  private static async cleanupTempFolder(result: CleanupResult): Promise<void> {
    const tempPath = runtimePaths.tempDir;

    if (!fs.existsSync(tempPath)) {
      console.log('⚠️  temp 폴더가 존재하지 않습니다');
      return;
    }

    try {
      console.log('📂 temp 폴더 정리 중...');
      this.deleteDirectoryRecursive(tempPath);

      // temp 폴더 재생성
      fs.mkdirSync(tempPath, { recursive: true });

      result.deletedDirs++;
      console.log('  ✅ temp 폴더 완전 정리 완료');
    } catch (error) {
      result.errors.push({
        path: tempPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      console.error('  ❌ temp 폴더 정리 실패:', error);
    }
  }

  /**
   * 디렉토리가 비어있는지 확인
   */
  private static isDirectoryEmpty(dirPath: string): boolean {
    try {
      const files = fs.readdirSync(dirPath);
      return files.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * 디렉토리를 재귀적으로 삭제
   */
  private static deleteDirectoryRecursive(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        this.deleteDirectoryRecursive(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }

    fs.rmdirSync(dirPath);
  }
}

/**
 * 직접 실행
 */
if (require.main === module) {
  FileSystemCleanup.cleanup()
    .then(result => {
      console.log('\n✅ 정리 완료');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ 정리 실패:', error);
      process.exit(1);
    });
}
