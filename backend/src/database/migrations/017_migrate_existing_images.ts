import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ImageSimilarityService } from '../../services/imageSimilarity';
import { runtimePaths } from '../../config/runtimePaths';

/**
 * 마이그레이션: 기존 images 테이블 데이터를 새로운 2-tier 구조로 이전
 * - 기존 images → image_metadata + image_files
 * - 해시가 없는 이미지는 생성
 */
export const up = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 017: 기존 이미지 데이터 마이그레이션 시작...');

  try {
    // 1. 기존 images 테이블에서 데이터 조회
    const existingImages = db.prepare('SELECT * FROM images').all() as any[];
    console.log(`  📊 마이그레이션 대상: ${existingImages.length}개 이미지`);

    if (existingImages.length === 0) {
      console.log('  ℹ️  마이그레이션할 이미지가 없습니다.');
      return;
    }

    let migrated = 0;
    let failed = 0;
    const errors: Array<{ id: number; error: string }> = [];

    // 2. 기본 폴더 ID 조회
    const uploadFolder = db.prepare(
      "SELECT id FROM watched_folders WHERE folder_type = 'upload'"
    ).get() as { id: number } | undefined;

    if (!uploadFolder) {
      throw new Error('기본 업로드 폴더를 찾을 수 없습니다');
    }

    console.log(`  📁 업로드 폴더 ID: ${uploadFolder.id}`);

    // 3. 각 이미지 마이그레이션
    for (const image of existingImages) {
      try {
        // 해시 생성 또는 재사용
        let compositeHash: string;
        let perceptualHash: string;
        let dHash: string;
        let aHash: string;

        const fullPath = path.join(runtimePaths.uploadsDir, image.file_path);

        // 파일 존재 확인
        if (!fs.existsSync(fullPath)) {
          console.warn(`  ⚠️  파일 없음: ${image.file_path}`);
          failed++;
          errors.push({
            id: image.id,
            error: 'File not found'
          });
          continue;
        }

        // 해시 생성
        try {
          const hashes = await ImageSimilarityService.generateCompositeHash(fullPath);
          compositeHash = hashes.compositeHash;
          perceptualHash = hashes.perceptualHash;
          dHash = hashes.dHash;
          aHash = hashes.aHash;
        } catch (hashError) {
          console.error(`  ❌ 해시 생성 실패: ${image.file_path}`, hashError);
          failed++;
          errors.push({
            id: image.id,
            error: `Hash generation failed: ${hashError instanceof Error ? hashError.message : 'Unknown'}`
          });
          continue;
        }

        // image_metadata에 삽입 (중복 체크)
        const existingMetadata = db.prepare(
          'SELECT composite_hash FROM image_metadata WHERE composite_hash = ?'
        ).get(compositeHash);

        if (!existingMetadata) {
          db.prepare(`
            INSERT INTO image_metadata (
              composite_hash, perceptual_hash, dhash, ahash, color_histogram,
              width, height, thumbnail_path, optimized_path,
              ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
              prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index,
              auto_tags, duration, fps, video_codec, audio_codec, bitrate, rating_score,
              first_seen_date, metadata_updated_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            compositeHash, perceptualHash, dHash, aHash, image.color_histogram,
            image.width, image.height, image.thumbnail_path, image.optimized_path,
            image.ai_tool, image.model_name, image.lora_models, image.steps, image.cfg_scale,
            image.sampler, image.seed, image.scheduler, image.prompt, image.negative_prompt,
            image.denoise_strength, image.generation_time, image.batch_size, image.batch_index,
            image.auto_tags, image.duration, image.fps, image.video_codec, image.audio_codec,
            image.bitrate, image.rating_score || 0, image.upload_date, image.upload_date
          );
        }

        // image_files에 삽입 (중복 체크)
        const existingFile = db.prepare(
          'SELECT id FROM image_files WHERE original_file_path = ?'
        ).get(fullPath);

        if (!existingFile) {
          db.prepare(`
            INSERT INTO image_files (
              composite_hash, original_file_path, folder_id,
              file_status, file_size, mime_type, file_modified_date,
              scan_date, last_verified_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            compositeHash, fullPath, uploadFolder.id,
            'active', image.file_size, image.mime_type, image.upload_date,
            image.upload_date, new Date().toISOString()
          );
        } else {
          // 이미 존재하는 경로면 스킵 (중복 데이터)
          console.warn(`  ⚠️  중복 경로 스킵: ${image.file_path}`);
        }

        migrated++;
        if (migrated % 100 === 0) {
          console.log(`  📊 진행 상황: ${migrated}/${existingImages.length}`);
        }
      } catch (error) {
        failed++;
        errors.push({
          id: image.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error(`  ❌ 이미지 ${image.id} 마이그레이션 실패:`, error);
      }
    }

    console.log(`✅ Migration 017: 마이그레이션 완료`);
    console.log(`  ✅ 성공: ${migrated}개`);
    console.log(`  ❌ 실패: ${failed}개`);

    if (errors.length > 0 && errors.length <= 10) {
      console.log(`  ⚠️  실패 상세:`, errors);
    } else if (errors.length > 10) {
      console.log(`  ⚠️  실패 상세 (처음 10개):`, errors.slice(0, 10));
    }
  } catch (error) {
    console.error('❌ Migration 017: 치명적 오류 발생:', error);
    throw error;
  }
};

export const down = async (db: Database.Database): Promise<void> => {
  console.log('🔄 Migration 017 rollback: 마이그레이션 데이터 제거...');

  // image_files, image_metadata 데이터 제거
  db.exec('DELETE FROM image_files');
  console.log('  ✅ image_files 데이터 제거');

  db.exec('DELETE FROM image_metadata');
  console.log('  ✅ image_metadata 데이터 제거');

  console.log('✅ Migration 017 rollback: 완료');
};
