import { db } from '../database/init';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import fg from 'fast-glob';
import pLimit from 'p-limit';
import { ImageSimilarityService } from './imageSimilarity';
import { WatchedFolderService } from './watchedFolderService';
import { BackgroundQueueService } from './backgroundQueue';
import { BackgroundProcessorService } from './backgroundProcessorService';
import { FileWatcherService } from './fileWatcherService';
import { resolveFolderPath } from '../utils/pathResolver';
import { ALL_SUPPORTED_EXTENSIONS, shouldProcessFileExtension, isVideoExtension } from '../constants/supportedExtensions';
import { generateFileHash } from '../utils/fileHash';
import { runtimePaths } from '../config/runtimePaths';
import { FileType } from '../types/image';

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
   * 파일 타입 결정 (image, video, animated)
   */
  private static determineFileType(mimeType: string, filePath: string): FileType {
    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gif' || ext === '.apng') {
      return 'animated';
    }

    return 'image';
  }

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
      console.log(`🔍 [Scan Debug] 경로 해석: ${folder.folder_path} → ${resolvedPath}`);

      // 3. 폴더 경로 유효성 확인
      const validation = await WatchedFolderService.validateFolderPath(resolvedPath);
      console.log(`🔍 [Scan Debug] 경로 유효성: exists=${validation.exists}, isDir=${validation.isDirectory}`);
      if (!validation.exists || !validation.isDirectory) {
        throw new Error(validation.error || '유효하지 않은 폴더 경로');
      }

      // 4. 스캔 상태 업데이트
      await WatchedFolderService.updateScanStatus(folderId, 'in_progress');

      // 5. 파일 목록 수집
      const files = await this.collectFiles(resolvedPath, {
        recursive: folder.recursive === 1,
        excludeExtensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
        excludePatterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : null
      });

      console.log(`📂 스캔 시작: ${resolvedPath} (${files.length}개 파일 발견, 배치 크기: ${this.BATCH_SIZE})`);
      if (files.length === 0) {
        console.warn(`⚠️ [Scan Debug] 파일 발견 실패 - 패턴 확인 필요: recursive=${folder.recursive === 1}, exclude_extensions=${folder.exclude_extensions}`);
      }

      // 6. 전체 재스캔인 경우 기존 파일들을 'missing'으로 표시
      if (fullRescan) {
        const updateInfo = db.prepare(`
          UPDATE image_files SET file_status = 'missing'
          WHERE folder_id = ? AND file_status = 'active'
        `).run(folderId);
        result.missingImages = updateInfo.changes;
        console.log(`  🔄 전체 재스캔: ${result.missingImages}개 파일 상태 변경`);
      }

      // 7. 배치별로 파일 처리 (Phase 1: 빠른 등록)
      await this.processFastRegistration(files, folderId, result);

      // 7.5. Phase 2 백그라운드 처리 트리거
      BackgroundProcessorService.triggerHashGeneration();

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
   * Phase 1: 빠른 등록 (해시 없이 기본 정보만 등록)
   * - composite_hash를 NULL로 설정하여 즉시 DB 등록
   * - 기본 이미지 정보만 수집 (파일 크기, 해상도, MIME 타입)
   * - 썸네일 및 해시 생성은 Phase 2에서 처리
   */
  private static async processFastRegistration(
    files: string[],
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    const batchStartTime = Date.now();

    // 동시성 제어: CPU 코어 수 * 4 (I/O 바운드 작업이므로 높게 설정)
    const concurrency = Math.min(os.cpus().length * 4, 20);
    const limit = pLimit(concurrency);
    console.log(`  ⚡ Phase 1: 빠른 등록 모드 (동시성: ${concurrency})`);

    const tasks = files.map((filePath, index) =>
      limit(async () => {
        try {
          const stats = fs.statSync(filePath);
          const mimeType = this.getMimeType(filePath);

          // 1. 기존 파일 확인 (경로로)
          const existingFile = db.prepare(
            'SELECT id, composite_hash FROM image_files WHERE original_file_path = ?'
          ).get(filePath) as { id: number; composite_hash: string | null } | undefined;

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
            result.totalScanned++;
            return;
          }

          // 2. 신규 파일 → 기본 정보만 수집 (해시는 Phase 2에서)
          // Sharp metadata만 가져오기 (빠름: ~5-20ms)
          let width: number | null = null;
          let height: number | null = null;

          try {
            const metadata = await sharp(filePath).metadata();
            width = metadata.width || null;
            height = metadata.height || null;
          } catch (error) {
            // 이미지 메타데이터 추출 실패해도 계속 진행
            console.warn(`  ⚠️  메타데이터 추출 실패: ${path.basename(filePath)}`);
          }

          // 3. composite_hash 없이 image_files에 등록
          const fileType = this.determineFileType(mimeType, filePath);
          db.prepare(`
            INSERT INTO image_files (
              composite_hash, file_type, original_file_path, folder_id,
              file_status, file_size, mime_type, file_modified_date
            ) VALUES (NULL, ?, ?, ?, 'active', ?, ?, ?)
          `).run(
            fileType,
            filePath,
            folderId,
            stats.size,
            mimeType,
            stats.mtime.toISOString()
          );

          result.newImages++;
          result.totalScanned++;

          // 진행 상황 로그
          if (result.totalScanned % this.PROGRESS_LOG_INTERVAL === 0 || result.totalScanned === files.length) {
            const elapsed = (Date.now() - batchStartTime) / 1000;
            const speed = elapsed > 0 ? result.totalScanned / elapsed : 0;
            const remaining = files.length - result.totalScanned;
            const eta = speed > 0 ? remaining / speed : 0;

            console.log(
              `  📊 Phase 1 진행: ${result.totalScanned}/${files.length} ` +
              `(${speed.toFixed(1)} 이미지/초, 예상 완료: ${this.formatETA(eta)})`
            );
          }
        } catch (error) {
          result.totalScanned++;
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.error(`  ❌ 등록 실패: ${path.basename(filePath)}`, error);
        }
      })
    );

    await Promise.all(tasks);

    const duration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    console.log(`  ✅ Phase 1 완료: ${result.newImages}개 신규, ${result.existingImages}개 기존 (${duration}초)`);
    console.log(`  🔨 Phase 2 백그라운드 처리 시작 예정...`);
  }

  /**
   * 배치 단위 파일 처리 (해시 생성 + 기본 정보 수집)
   * @deprecated Phase 1 빠른 등록 방식으로 대체됨 (processFastRegistration)
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

    // 2. 신규 파일 → 해시 및 히스토그램 생성 (최적화: 2x Sharp 파이프라인)
    const result = await ImageSimilarityService.generateHashAndHistogram(filePath);

    return {
      filePath,
      stats,
      mimeType,
      hashes: result.hashes,
      colorHistogram: result.colorHistogram
    };
  }

  /**
   * Bulk 쿼리로 배치 처리 (핵심 최적화) - p-limit 동시성 제어 적용
   * @deprecated Phase 1/2 시스템으로 대체됨 (processFastRegistration → backgroundProcessor)
   * @removed 사용되지 않으므로 삭제 예정
   */
  private static async processBatchWithBulkQueries(
    files: string[],
    folderId: number,
    result: ScanResult
  ): Promise<void> {
    const batchStartTime = Date.now();

    // 1. p-limit으로 동시성 제어 (CPU 코어 수 * 2)
    const concurrency = Math.min(os.cpus().length * 2, 16);
    const limit = pLimit(concurrency);
    console.log(`  ⚡ 동시성 제어: ${concurrency}개 동시 처리`);

    // 2. 모든 파일을 동시성 제어하에 병렬 처리
    const processedFiles: ProcessedFileData[] = [];

    const tasks = files.map((filePath, index) =>
      limit(async () => {
        try {
          const fileData = await this.processFileBatch(filePath, folderId);
          result.totalScanned++;

          // 진행 상황 로그
          if (result.totalScanned % this.PROGRESS_LOG_INTERVAL === 0 || result.totalScanned === files.length) {
            const elapsed = (Date.now() - batchStartTime) / 1000;
            const speed = elapsed > 0 ? result.totalScanned / elapsed : 0;
            const remaining = files.length - result.totalScanned;
            const eta = speed > 0 ? remaining / speed : 0;

            console.log(
              `  📊 진행: ${result.totalScanned}/${files.length} ` +
              `(${speed.toFixed(1)} 이미지/초, 예상 완료: ${this.formatETA(eta)})`
            );
          }

          return fileData;
        } catch (error) {
          result.totalScanned++;
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return null;
        }
      })
    );

    const results = await Promise.all(tasks);

    // 유효한 결과만 수집
    for (const fileData of results) {
      if (fileData && fileData.hashes) {
        processedFiles.push(fileData);
      } else if (fileData && !fileData.hashes) {
        result.existingImages++;
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
        const fileType = this.determineFileType(mimeType, filePath);
        db.prepare(`
          INSERT INTO image_files (
            composite_hash, file_type, original_file_path, folder_id,
            file_status, file_size, mime_type, file_modified_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          hashes!.compositeHash,
          fileType,
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
      // 절대 경로로 디렉토리 생성 (uploads 폴더 내부)
      const tempDir = path.join(runtimePaths.uploadsDir, 'temp', 'images', dateStr, 'thumbnails');
      await fs.promises.mkdir(tempDir, { recursive: true });
      // DB 저장용 상대 경로 (uploads 제외)
      const thumbnailPath = path.join('temp', 'images', dateStr, 'thumbnails', `${hashes.compositeHash}.webp`);

      // image_metadata 삽입
      db.prepare(`
        INSERT INTO image_metadata (
          composite_hash, perceptual_hash, dhash, ahash, color_histogram,
          width, height, thumbnail_path,
          ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
          auto_tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        hashes.perceptualHash,
        hashes.dHash,
        hashes.aHash,
        colorHistogramJson,
        imageInfo.width,
        imageInfo.height,
        thumbnailPath,
        null, null, null, null, null, null, null, null, null, null, null, null, null, null, null
      );

      // image_files 삽입
      const fileType = this.determineFileType(mimeType, filePath);
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        fileType,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      // 썸네일 생성 (해시별 1개만)
      const absoluteThumbnailPath = path.join(runtimePaths.uploadsDir, thumbnailPath);
      if (!fs.existsSync(absoluteThumbnailPath)) {
        await this.generateThumbnail(filePath, absoluteThumbnailPath, mimeType);
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
      const fileType = this.determineFileType(mimeType, filePath);
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        fileType,
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
      const tempDir = path.join('temp', 'images', dateStr, 'thumbnails');
      await fs.promises.mkdir(tempDir, { recursive: true });
      const thumbnailPath = path.join(tempDir, `${hashes.compositeHash}.webp`);

      // 6. image_metadata 기본 정보만 우선 삽입 (AI 메타데이터는 백그라운드에서)
      db.prepare(`
        INSERT INTO image_metadata (
          composite_hash, perceptual_hash, dhash, ahash, color_histogram,
          width, height, thumbnail_path,
          ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
          auto_tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        hashes.perceptualHash,
        hashes.dHash,
        hashes.aHash,
        colorHistogramJson,
        imageInfo.width,
        imageInfo.height,
        thumbnailPath,
        null, null, null, null, null, null, null, null, null, null, null, null, null, null, null
      );

      // 7. image_files 삽입
      const fileType = this.determineFileType(mimeType, filePath);
      db.prepare(`
        INSERT INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hashes.compositeHash,
        fileType,
        filePath,
        folderId,
        'active',
        stats.size,
        mimeType,
        stats.mtime.toISOString()
      );

      // 8. 썸네일 생성 (해시별 1개만)
      if (!fs.existsSync(thumbnailPath)) {
        await this.generateThumbnail(filePath, thumbnailPath, mimeType);
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
    outputPath: string,
    mimeType: string
  ): Promise<void> {
    // 비디오 파일은 썸네일 생성하지 않음 (원본 사용)
    if (mimeType.startsWith('video/')) {
      return;
    }

    // 이미지 파일만 Sharp로 썸네일 생성
    await sharp(inputPath)
      .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 90 })
      .toFile(outputPath);
  }

  /**
   * 파일 수집 (재귀적) - fast-glob 사용으로 최적화
   *
   * 새로운 로직:
   * 1. 모든 지원 확장자 파일을 스캔
   * 2. 사용자가 제외한 확장자 제거
   */
  private static async collectFiles(
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

    console.log(`🔍 [Scan Debug] Fast-glob 패턴:`, patterns);
    console.log(`🔍 [Scan Debug] 지원 확장자:`, ALL_SUPPORTED_EXTENSIONS);
    console.log(`🔍 [Scan Debug] 제외 확장자:`, options.excludeExtensions);
    console.log(`🔍 [Scan Debug] 제외 패턴:`, options.excludePatterns);

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

      console.log(`🔍 [Scan Debug] Fast-glob 결과: ${allFiles.length}개 파일 발견`);

      // Step 2: 제외 확장자 필터링
      const filteredFiles = allFiles.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return shouldProcessFileExtension(ext, options.excludeExtensions);
      });

      if (filteredFiles.length < allFiles.length) {
        console.log(`🔍 [Scan Debug] 제외 필터 적용: ${allFiles.length} → ${filteredFiles.length}개 파일`);
      }

      if (filteredFiles.length > 0) {
        console.log(`🔍 [Scan Debug] 처음 3개 파일:`, filteredFiles.slice(0, 3));
      }

      return filteredFiles;
    } catch (error) {
      console.error(`  ❌ 파일 스캔 실패: ${dirPath}`, error);
      return [];
    }
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
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.gif': 'video/gif'  // GIF는 비디오로 분류
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
   * 실시간 워처가 활성화된 폴더는 전체 스캔 건너뛰기 (백업 검증만 수행)
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
        // 워처 상태 확인
        const watcherStatus = FileWatcherService.getWatcherStatus(folder.id);
        const isWatcherActive = watcherStatus && watcherStatus.state === 'watching';

        // 워처가 활성화되어 있고 최근 이벤트가 있으면 전체 스캔 건너뛰기
        if (isWatcherActive && watcherStatus.lastEvent) {
          const timeSinceLastEvent = Date.now() - watcherStatus.lastEvent.getTime();
          const oneHourMs = 60 * 60 * 1000;

          // 마지막 이벤트가 1시간 이내면 전체 스캔 스킵
          if (timeSinceLastEvent < oneHourMs) {
            console.log(`  ⏭️  워처 활성: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
            continue;
          } else {
            console.log(`  🔄 백업 검증 스캔: ${folder.folder_name} (마지막 이벤트: ${Math.round(timeSinceLastEvent / 1000 / 60)}분 전)`);
          }
        }

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
