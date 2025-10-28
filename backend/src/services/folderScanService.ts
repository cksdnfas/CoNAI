import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ImageSimilarityService } from './imageSimilarity';
import { WatchedFolderService } from './watchedFolderService';
import { BackgroundQueueService } from './backgroundQueue';

export interface ScanResult {
  folderId: number;
  totalScanned: number;
  newImages: number;
  existingImages: number;
  updatedPaths: number;
  missingImages: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
  thumbnailsGenerated: number;
  backgroundTasks: number;
}

export class FolderScanService {
  private static readonly BATCH_SIZE = 10; // 병렬 처리 배치 크기
  private static readonly THUMBNAIL_SIZE = 1080;

  /**
   * 폴더 스캔 실행 (병렬 처리 최적화)
   */
  static async scanFolder(folderId: number, fullRescan: boolean = false): Promise<ScanResult> {
    const startTime = Date.now();
    const result: ScanResult = {
      folderId,
      totalScanned: 0,
      newImages: 0,
      existingImages: 0,
      updatedPaths: 0,
      missingImages: 0,
      errors: [],
      duration: 0,
      thumbnailsGenerated: 0,
      backgroundTasks: 0
    };

    try {
      // 1. 폴더 정보 조회
      const folder = await WatchedFolderService.getFolder(folderId);
      if (!folder) {
        throw new Error(`폴더를 찾을 수 없습니다: ${folderId}`);
      }

      if (!folder.is_active) {
        throw new Error('비활성화된 폴더입니다');
      }

      // 2. 폴더 경로 유효성 확인
      const validation = await WatchedFolderService.validateFolderPath(folder.folder_path);
      if (!validation.exists || !validation.isDirectory) {
        throw new Error(validation.error || '유효하지 않은 폴더 경로');
      }

      // 3. 스캔 상태 업데이트
      await WatchedFolderService.updateScanStatus(folderId, 'in_progress');

      // 4. 파일 목록 수집
      const files = this.collectFiles(folder.folder_path, {
        recursive: folder.recursive === 1,
        extensions: folder.file_extensions ? JSON.parse(folder.file_extensions) : null,
        excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
      });

      console.log(`📂 스캔 시작: ${folder.folder_path} (${files.length}개 파일)`);

      // 5. 전체 재스캔인 경우 기존 파일들을 'missing'으로 표시
      if (fullRescan) {
        const updateInfo = db.prepare(`
          UPDATE image_files SET file_status = 'missing'
          WHERE folder_id = ? AND file_status = 'active'
        `).run(folderId);
        result.missingImages = updateInfo.changes;
        console.log(`  🔄 전체 재스캔: ${result.missingImages}개 파일 상태 변경`);
      }

      // 6. 각 파일 배치 병렬 처리 (10개씩)
      for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
        const batch = files.slice(i, i + this.BATCH_SIZE);

        // 배치 병렬 처리
        const batchResults = await Promise.allSettled(
          batch.map(filePath => this.processFile(filePath, folderId, result))
        );

        // 결과 집계
        batchResults.forEach((batchResult, index) => {
          result.totalScanned++;

          if (batchResult.status === 'rejected') {
            result.errors.push({
              file: batch[index],
              error: batchResult.reason instanceof Error ? batchResult.reason.message : 'Unknown error'
            });
          }
        });

        // 진행 상황 로그 (100개마다)
        if (result.totalScanned % 100 === 0) {
          console.log(`  📊 진행: ${result.totalScanned}/${files.length} (배치 ${i / this.BATCH_SIZE + 1})`);
        }
      }

      // 7. 스캔 완료 상태 업데이트
      await WatchedFolderService.updateScanStatus(
        folderId,
        result.errors.length > 0 ? 'error' : 'success',
        result.newImages + result.existingImages,
        result.errors.length > 0 ? `${result.errors.length}개 파일 처리 실패` : undefined
      );

      result.duration = Date.now() - startTime;
      console.log(`✅ 스캔 완료: ${result.duration}ms`);
      console.log(`  📊 신규: ${result.newImages}, 기존: ${result.existingImages}, 업데이트: ${result.updatedPaths}, 오류: ${result.errors.length}`);

      return result;
    } catch (error) {
      await WatchedFolderService.updateScanStatus(
        folderId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * 파일 처리 (병렬 최적화 + 백그라운드 작업)
   */
  private static async processFile(
    filePath: string,
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    // 1. 파일 정보 수집
    const stats = fs.statSync(filePath);
    const mimeType = this.getMimeType(filePath);

    // 2. 기존 파일 확인 (경로로)
    const existingFile = db.prepare(
      'SELECT * FROM image_files WHERE original_file_path = ?'
    ).get(filePath) as any;

    if (existingFile) {
      // 기존 파일 발견 → 상태 업데이트
      db.prepare(`
        UPDATE image_files
        SET file_status = 'active',
            last_verified_date = ?,
            file_modified_date = ?,
            file_size = ?
        WHERE id = ?
      `).run(
        new Date().toISOString(),
        stats.mtime.toISOString(),
        stats.size,
        existingFile.id
      );

      result.existingImages++;
      return;
    }

    // 3. 신규 파일 → 해시 생성 병렬화
    const [hashes, colorHistogram] = await Promise.all([
      ImageSimilarityService.generateCompositeHash(filePath),
      ImageSimilarityService.generateColorHistogram(filePath)
    ]);

    // 4. 메타데이터 확인 (같은 이미지가 다른 경로에 있을 수 있음)
    const existingMetadata = db.prepare(
      'SELECT * FROM image_metadata WHERE composite_hash = ?'
    ).get(hashes.compositeHash) as any;

    if (existingMetadata) {
      // 같은 이미지가 이미 존재 → image_files에만 추가
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      result.existingImages++;
      console.log(`  ♻️  동일 이미지 발견 (다른 경로): ${path.basename(filePath)}`);
      return;
    }

    // 5. 완전히 새로운 이미지 → 메타데이터 기본 등록 및 썸네일 생성
    try {
      // 이미지 정보 추출
      const imageInfo = await sharp(filePath).metadata();

      // 색상 히스토그램 직렬화
      const colorHistogramJson = ImageSimilarityService.serializeHistogram(colorHistogram);

      // 썸네일 경로 생성 (temp 폴더에 저장, 해시 기반)
      const dateStr = new Date().toISOString().split('T')[0];
      const tempDir = path.join('uploads', 'temp', 'images', dateStr, 'thumbnails');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const thumbnailPath = path.join(tempDir, `${hashes.compositeHash}.webp`);

      // 6. image_metadata 기본 정보만 우선 삽입 (AI 메타데이터는 백그라운드에서)
      db.prepare(`
        INSERT INTO image_metadata (
          composite_hash, perceptual_hash, dhash, ahash, color_histogram,
          width, height, thumbnail_path, optimized_path,
          ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
          auto_tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        hashes.perceptualHash,
        hashes.dHash,
        hashes.aHash,
        colorHistogramJson,
        imageInfo.width,
        imageInfo.height,
        thumbnailPath,
        null, // optimized_path는 더 이상 사용 안 함
        null, null, null, null, null, null, null, null, null, null, null, null, null, null, null
      );

      // 7. image_files 삽입
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      // 8. 썸네일 생성 (해시별 1개만)
      if (!fs.existsSync(thumbnailPath)) {
        await this.generateThumbnail(filePath, thumbnailPath);
        result.thumbnailsGenerated++;
      }

      // 9. 백그라운드 작업 추가 (실패해도 스캔 성공)
      BackgroundQueueService.addMetadataExtractionTask(filePath, hashes.compositeHash);
      BackgroundQueueService.addAutoTaggingTask(filePath, hashes.compositeHash);
      BackgroundQueueService.addPromptCollectionTask(filePath, hashes.compositeHash);
      result.backgroundTasks += 3;

      result.newImages++;
      console.log(`  ✨ 신규 이미지: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`  ❌ 이미지 처리 실패: ${path.basename(filePath)}`, error);
      throw error;
    }
  }

  /**
   * 썸네일 생성
   */
  private static async generateThumbnail(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    await sharp(inputPath)
      .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 90 })
      .toFile(outputPath);
  }

  /**
   * 파일 수집 (재귀적)
   */
  private static collectFiles(
    dirPath: string,
    options: {
      recursive: boolean;
      extensions: string[] | null;
      excludePatterns: string[] | null;
    }
  ): string[] {
    const files: string[] = [];
    const imageExtensions = options.extensions || [
      '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'
    ];

    const traverse = (currentPath: string) => {
      try {
        const items = fs.readdirSync(currentPath);

        for (const item of items) {
          const fullPath = path.join(currentPath, item);

          try {
            const stats = fs.statSync(fullPath);

            // 제외 패턴 확인
            if (options.excludePatterns) {
              const shouldExclude = options.excludePatterns.some(pattern =>
                fullPath.includes(pattern)
              );
              if (shouldExclude) continue;
            }

            if (stats.isDirectory()) {
              if (options.recursive) {
                traverse(fullPath);
              }
            } else if (stats.isFile()) {
              const ext = path.extname(fullPath).toLowerCase();
              if (imageExtensions.includes(ext)) {
                files.push(fullPath);
              }
            }
          } catch (itemError) {
            // 개별 파일/폴더 접근 오류는 무시 (권한 문제 등)
            console.warn(`  ⚠️  접근 불가: ${fullPath}`);
          }
        }
      } catch (dirError) {
        console.error(`  ❌ 디렉토리 읽기 실패: ${currentPath}`, dirError);
      }
    };

    traverse(dirPath);
    return files;
  }

  /**
   * MIME 타입 추정
   */
  private static getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * 모든 활성 폴더 스캔
   */
  static async scanAllFolders(): Promise<ScanResult[]> {
    const folders = await WatchedFolderService.listFolders({ active_only: true });
    const results: ScanResult[] = [];

    for (const folder of folders) {
      try {
        console.log(`\n🔍 폴더 스캔 시작: ${folder.folder_name} (${folder.folder_path})`);
        const result = await this.scanFolder(folder.id);
        results.push(result);
      } catch (error) {
        console.error(`❌ 폴더 스캔 실패: ${folder.folder_path}`, error);
        results.push({
          folderId: folder.id,
          totalScanned: 0,
          newImages: 0,
          existingImages: 0,
          updatedPaths: 0,
          missingImages: 0,
          errors: [{
            file: folder.folder_path,
            error: error instanceof Error ? error.message : 'Unknown'
          }],
          duration: 0,
          thumbnailsGenerated: 0,
          backgroundTasks: 0
        });
      }
    }

    return results;
  }

  /**
   * 자동 스캔 실행 (스케줄러용)
   */
  static async runAutoScan(): Promise<ScanResult[]> {
    console.log('🤖 자동 스캔 시작...');

    const folders = await WatchedFolderService.getFoldersNeedingScan();

    if (folders.length === 0) {
      console.log('  ℹ️  스캔이 필요한 폴더가 없습니다.');
      return [];
    }

    console.log(`  📂 스캔 대상: ${folders.length}개 폴더`);

    const results: ScanResult[] = [];

    for (const folder of folders) {
      try {
        console.log(`\n🔍 자동 스캔: ${folder.folder_name}`);
        const result = await this.scanFolder(folder.id, false);
        results.push(result);
      } catch (error) {
        console.error(`❌ 자동 스캔 실패: ${folder.folder_path}`, error);
        results.push({
          folderId: folder.id,
          totalScanned: 0,
          newImages: 0,
          existingImages: 0,
          updatedPaths: 0,
          missingImages: 0,
          errors: [{
            file: folder.folder_path,
            error: error instanceof Error ? error.message : 'Unknown'
          }],
          duration: 0,
          thumbnailsGenerated: 0,
          backgroundTasks: 0
        });
      }
    }

    console.log('\n✅ 자동 스캔 완료');
    return results;
  }
}
