import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { ImageSimilarityService } from './imageSimilarity';
import { WatchedFolderService } from './watchedFolderService';
import { BackgroundQueueService } from './backgroundQueue';
import { resolveFolderPath } from '../utils/pathResolver';

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

interface ProcessedFileData {
  filePath: string;
  stats: fs.Stats;
  mimeType: string;
  hashes?: {
    compositeHash: string;
    perceptualHash: string;
    dHash: string;
    aHash: string;
  };
  colorHistogram?: any;
}

export class FolderScanService {
  // 동적 배치 크기 계산: CPU 코어 수 기반 (최소 20, 최대 100)
  private static readonly BATCH_SIZE = Math.min(Math.max(os.cpus().length * 5, 20), 100);
  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly PROGRESS_LOG_INTERVAL = 50; // 50개마다 진행 상황 로그

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

      // 2. 폴더 경로 해석 (상대 경로 → 절대 경로)
      const resolvedPath = resolveFolderPath(folder.folder_path);

      // 3. 폴더 경로 유효성 확인
      const validation = await WatchedFolderService.validateFolderPath(resolvedPath);
      if (!validation.exists || !validation.isDirectory) {
        throw new Error(validation.error || '유효하지 않은 폴더 경로');
      }

      // 4. 스캔 상태 업데이트
      await WatchedFolderService.updateScanStatus(folderId, 'in_progress');

      // 5. 파일 목록 수집
      const files = this.collectFiles(resolvedPath, {
        recursive: folder.recursive === 1,
        extensions: folder.file_extensions ? JSON.parse(folder.file_extensions) : null,
        excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
      });

      console.log(`📂 스캔 시작: ${resolvedPath} (${files.length}개 파일, 배치 크기: ${this.BATCH_SIZE})`);

      // 6. 전체 재스캔인 경우 기존 파일들을 'missing'으로 표시
      if (fullRescan) {
        const updateInfo = db.prepare(`
          UPDATE image_files SET file_status = 'missing'
          WHERE folder_id = ? AND file_status = 'active'
        `).run(folderId);
        result.missingImages = updateInfo.changes;
        console.log(`  🔄 전체 재스캔: ${result.missingImages}개 파일 상태 변경`);
      }

      // 7. 배치별로 파일 처리 (Bulk 쿼리 최적화)
      await this.processBatchWithBulkQueries(files, folderId, result);

      // 8. 스캔 완료 상태 업데이트
      await WatchedFolderService.updateScanStatus(
        folderId,
        result.errors.length > 0 ? 'error' : 'success',
        result.newImages + result.existingImages,
        result.errors.length > 0 ? `${result.errors.length}개 파일 처리 실패` : undefined
      );

      result.duration = Date.now() - startTime;

      // 9. 스캔 로그 저장
      this.saveScanLog(folderId, result);

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
   * ETA 포맷팅 (초 → "Xm Ys" 형식)
   */
  private static formatETA(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '계산 중...';
    if (seconds < 60) return `${Math.round(seconds)}초`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (minutes < 60) {
      return `${minutes}분 ${remainingSeconds}초`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}시간 ${remainingMinutes}분`;
  }

  /**
   * 배치 단위 파일 처리 (해시 생성 + 기본 정보 수집)
   */
  private static async processFileBatch(
    filePath: string,
    folderId: number
  ): Promise<ProcessedFileData> {
    const stats = fs.statSync(filePath);
    const mimeType = this.getMimeType(filePath);

    // 1. 기존 파일 확인 (경로로)
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

      return { filePath, stats, mimeType };
    }

    // 2. 신규 파일 → 해시 생성 (병렬화)
    const [hashes, colorHistogram] = await Promise.all([
      ImageSimilarityService.generateCompositeHash(filePath),
      ImageSimilarityService.generateColorHistogram(filePath)
    ]);

    return {
      filePath,
      stats,
      mimeType,
      hashes,
      colorHistogram
    };
  }

  /**
   * Bulk 쿼리로 배치 처리 (핵심 최적화)
   */
  private static async processBatchWithBulkQueries(
    files: string[],
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    const batchStartTime = Date.now();

    // 1. 배치별로 해시 생성 (병렬 처리)
    const processedFiles: ProcessedFileData[] = [];

    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(filePath => this.processFileBatch(filePath, folderId))
      );

      // 결과 집계
      for (let j = 0; j < batchResults.length; j++) {
        const batchResult = batchResults[j];
        result.totalScanned++;

        if (batchResult.status === 'rejected') {
          result.errors.push({
            file: batch[j],
            error: batchResult.reason instanceof Error ? batchResult.reason.message : 'Unknown error'
          });
        } else if (batchResult.value.hashes) {
          processedFiles.push(batchResult.value);
        } else {
          result.existingImages++;
        }
      }

      // 진행 상황 로그 (설정된 간격마다)
      if (result.totalScanned % this.PROGRESS_LOG_INTERVAL === 0 || i + this.BATCH_SIZE >= files.length) {
        const elapsed = (Date.now() - batchStartTime) / 1000;
        const speed = elapsed > 0 ? result.totalScanned / elapsed : 0;
        const remaining = files.length - result.totalScanned;
        const eta = speed > 0 ? remaining / speed : 0;

        console.log(
          `  📊 진행: ${result.totalScanned}/${files.length} ` +
          `(${speed.toFixed(1)} 이미지/초, 예상 완료: ${this.formatETA(eta)})`
        );
      }
    }

    // 2. Bulk 쿼리: 모든 해시를 한 번에 확인
    if (processedFiles.length === 0) return;

    const allHashes = processedFiles.map(f => f.hashes!.compositeHash);

    // SQLite IN 쿼리 최대 파라미터 제한 처리 (999개)
    const SQLITE_MAX_PARAMS = 999;
    const existingHashSet = new Set<string>();

    for (let i = 0; i < allHashes.length; i += SQLITE_MAX_PARAMS) {
      const hashChunk = allHashes.slice(i, i + SQLITE_MAX_PARAMS);
      const placeholders = hashChunk.map(() => '?').join(',');

      const existingMetadata = db.prepare(`
        SELECT composite_hash FROM image_metadata
        WHERE composite_hash IN (${placeholders})
      `).all(...hashChunk) as Array<{ composite_hash: string }>;

      existingMetadata.forEach(m => existingHashSet.add(m.composite_hash));
    }

    console.log(`  🔍 Bulk 쿼리 완료: ${processedFiles.length}개 중 ${existingHashSet.size}개 기존 이미지 발견`);

    // 3. 각 파일 처리 (DB 조회는 Set에서 O(1) 검색)
    for (const fileData of processedFiles) {
      const { filePath, stats, mimeType, hashes, colorHistogram } = fileData;

      if (existingHashSet.has(hashes!.compositeHash)) {
        // 같은 이미지가 이미 존재 → image_files에만 추가
        db.prepare(`
          INSERT INTO image_files (
            composite_hash, original_file_path, folder_id,
            file_status, file_size, mime_type, file_modified_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          hashes!.compositeHash,
          filePath,
          folderId,
          'active',
          stats.size,
          mimeType,
          stats.mtime.toISOString()
        );

        result.existingImages++;
        console.log(`  ♻️  동일 이미지 발견 (다른 경로): ${path.basename(filePath)}`);
      } else {
        // 완전히 새로운 이미지 → 메타데이터 등록
        await this.insertNewImage(filePath, folderId, stats, mimeType, hashes!, colorHistogram!, result);
      }
    }
  }

  /**
   * 신규 이미지 삽입 (메타데이터 + 썸네일 생성)
   */
  private static async insertNewImage(
    filePath: string,
    folderId: number,
    stats: fs.Stats,
    mimeType: string,
    hashes: { compositeHash: string; perceptualHash: string; dHash: string; aHash: string },
    colorHistogram: any,
    result: ScanResult
  ): Promise<void> {
    try {
      // 이미지 정보 추출
      const imageInfo = await sharp(filePath).metadata();

      // 색상 히스토그램 직렬화
      const colorHistogramJson = ImageSimilarityService.serializeHistogram(colorHistogram);

      // 썸네일 경로 생성
      const dateStr = new Date().toISOString().split('T')[0];
      const tempDir = path.join('uploads', 'temp', 'images', dateStr, 'thumbnails');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const thumbnailPath = path.join(tempDir, `${hashes.compositeHash}.webp`);

      // image_metadata 삽입
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
        null,
        null, null, null, null, null, null, null, null, null, null, null, null, null, null, null
      );

      // image_files 삽입
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

      // 썸네일 생성 (해시별 1개만)
      if (!fs.existsSync(thumbnailPath)) {
        await this.generateThumbnail(filePath, thumbnailPath);
        result.thumbnailsGenerated++;
      }

      // 백그라운드 작업 추가
      BackgroundQueueService.addMetadataExtractionTask(filePath, hashes.compositeHash);
      // Auto-tagging is handled separately by AutoTagScheduler (see backgroundQueue.ts:34)
      BackgroundQueueService.addPromptCollectionTask(filePath, hashes.compositeHash);
      result.backgroundTasks += 2;

      result.newImages++;
      console.log(`  ✨ 신규 이미지: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`  ❌ 이미지 처리 실패: ${path.basename(filePath)}`, error);
      throw error;
    }
  }

  /**
   * 파일 처리 (병렬 최적화 + 백그라운드 작업)
   * @deprecated 새로운 bulk 쿼리 방식으로 대체됨 (processBatchWithBulkQueries)
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
      // 참고: 자동 태깅은 AutoTagScheduler가 별도로 처리
      BackgroundQueueService.addMetadataExtractionTask(filePath, hashes.compositeHash);
      BackgroundQueueService.addPromptCollectionTask(filePath, hashes.compositeHash);
      result.backgroundTasks += 2;

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

  /**
   * 스캔 로그 저장
   */
  private static saveScanLog(folderId: number, result: ScanResult): void {
    try {
      db.prepare(`
        INSERT INTO scan_logs (
          folder_id, scan_date, scan_status,
          total_scanned, new_images, existing_images, updated_paths, missing_images,
          errors_count, duration_ms, error_details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        folderId,
        new Date().toISOString(),
        result.errors.length > 0 ? 'error' : 'success',
        result.totalScanned,
        result.newImages,
        result.existingImages,
        result.updatedPaths,
        result.missingImages,
        result.errors.length,
        result.duration,
        result.errors.length > 0 ? JSON.stringify(result.errors) : null
      );
    } catch (error) {
      console.error('스캔 로그 저장 실패:', error);
    }
  }

  /**
   * 스캔 로그 조회
   */
  static getScanLogs(folderId: number, limit: number = 50): any[] {
    const logs = db.prepare(`
      SELECT * FROM scan_logs
      WHERE folder_id = ?
      ORDER BY scan_date DESC
      LIMIT ?
    `).all(folderId, limit) as any[];

    return logs.map(log => ({
      ...log,
      error_details: log.error_details ? JSON.parse(log.error_details) : []
    }));
  }

  /**
   * 최근 스캔 로그 조회 (모든 폴더)
   */
  static getRecentScanLogs(limit: number = 100): any[] {
    const logs = db.prepare(`
      SELECT sl.*, wf.folder_name, wf.folder_path
      FROM scan_logs sl
      JOIN watched_folders wf ON sl.folder_id = wf.id
      ORDER BY sl.scan_date DESC
      LIMIT ?
    `).all(limit) as any[];

    return logs.map(log => ({
      ...log,
      error_details: log.error_details ? JSON.parse(log.error_details) : []
    }));
  }
}
