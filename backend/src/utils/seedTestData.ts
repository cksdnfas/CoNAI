import { db } from '../database/init';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

/**
 * 테스트용 더미 데이터 생성
 */
export async function seedTestData(): Promise<void> {
  console.log('🌱 테스트 데이터를 생성합니다...');

  // 테스트용 업로드 폴더 구조 생성
  const testUploadPath = runtimePaths.uploadsDir;
  const today = new Date().toISOString().split('T')[0];
  const testDateFolder = path.join(testUploadPath, today);
  const testOriginFolder = path.join(testDateFolder, 'Origin');
  const testThumbnailFolder = path.join(testDateFolder, 'thumbnails');

  // 폴더 생성
  await fs.promises.mkdir(testOriginFolder, { recursive: true });
  await fs.promises.mkdir(testThumbnailFolder, { recursive: true });

  const testImages = [
    {
      filename: '2024_01_15_143020_test001.png',
      original_name: 'comfyui_anime_girl.png',
      file_path: `${today}/Origin/2024_01_15_143020_test001.png`,
      thumbnail_path: `${today}/thumbnails/2024_01_15_143020_test001.webp`,
      file_size: 2048000,
      mime_type: 'image/png',
      width: 768,
      height: 1024,
      ai_tool: 'ComfyUI',
      model_name: 'realisticVisionV60B1_v60B1VAE.safetensors',
      lora_models: JSON.stringify(['detail_tweaker:0.8', 'add_detail:0.5']),
      steps: 20,
      cfg_scale: 7.0,
      sampler: 'DPM++ 2M Karras',
      seed: 123456789,
      scheduler: 'normal',
      prompt: 'masterpiece, best quality, 1girl, anime style, beautiful face, detailed eyes, long hair, school uniform, cherry blossoms background',
      negative_prompt: 'bad quality, blurry, distorted, low resolution, bad anatomy, bad hands',
      denoise_strength: 0.75,
      generation_time: 15.2,
      batch_size: 1,
      batch_index: 0,
      metadata: JSON.stringify({
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'ComfyUI',
          model: 'realisticVisionV60B1_v60B1VAE.safetensors',
          lora_models: ['detail_tweaker:0.8', 'add_detail:0.5']
        }
      })
    },
    {
      filename: '2024_01_15_144530_test002.jpg',
      original_name: 'novelai_landscape.jpg',
      file_path: `${today}/Origin/2024_01_15_144530_test002.jpg`,
      thumbnail_path: `${today}/thumbnails/2024_01_15_144530_test002.webp`,
      file_size: 1024000,
      mime_type: 'image/jpeg',
      width: 1024,
      height: 768,
      ai_tool: 'NovelAI',
      model_name: 'NAI Diffusion Anime V3',
      lora_models: null,
      steps: 28,
      cfg_scale: 5.5,
      sampler: 'Euler a',
      seed: 987654321,
      scheduler: 'exponential',
      prompt: 'beautiful landscape, mountains, sunset, dramatic sky, vibrant colors, highly detailed',
      negative_prompt: 'low quality, worst quality, blurry, jpeg artifacts',
      denoise_strength: null,
      generation_time: 8.7,
      batch_size: 4,
      batch_index: 2,
      metadata: JSON.stringify({
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'NovelAI',
          model: 'NAI Diffusion Anime V3'
        }
      })
    },
    {
      filename: '2024_01_15_150045_test003.png',
      original_name: 'automatic1111_portrait.png',
      file_path: `${today}/Origin/2024_01_15_150045_test003.png`,
      thumbnail_path: `${today}/thumbnails/2024_01_15_150045_test003.webp`,
      file_size: 3072000,
      mime_type: 'image/png',
      width: 512,
      height: 768,
      ai_tool: 'Automatic1111',
      model_name: 'deliberate_v2.safetensors',
      lora_models: JSON.stringify(['epiNoiseoffset_v2:1.0']),
      steps: 30,
      cfg_scale: 8.5,
      sampler: 'DPM++ SDE Karras',
      seed: 555444333,
      scheduler: 'karras',
      prompt: 'portrait of a beautiful woman, professional photography, studio lighting, elegant dress, detailed skin texture',
      negative_prompt: 'ugly, deformed, blurry, bad anatomy, extra limbs, low quality',
      denoise_strength: 0.6,
      generation_time: 22.1,
      batch_size: 1,
      batch_index: 0,
      metadata: JSON.stringify({
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Automatic1111',
          model: 'deliberate_v2.safetensors',
          lora_models: ['epiNoiseoffset_v2:1.0']
        }
      })
    },
    {
      filename: '2024_01_15_151200_test004.png',
      original_name: 'stable_diffusion_abstract.png',
      file_path: `${today}/Origin/2024_01_15_151200_test004.png`,
      thumbnail_path: `${today}/thumbnails/2024_01_15_151200_test004.webp`,
      file_size: 1536000,
      mime_type: 'image/png',
      width: 768,
      height: 768,
      ai_tool: 'Stable Diffusion',
      model_name: 'sd_xl_base_1.0.safetensors',
      lora_models: JSON.stringify(['style_lora:0.7', 'color_enhance:0.3']),
      steps: 25,
      cfg_scale: 7.5,
      sampler: 'DDIM',
      seed: 111222333,
      scheduler: 'discrete',
      prompt: 'abstract art, colorful patterns, geometric shapes, modern design, vibrant colors, artistic composition',
      negative_prompt: 'realistic, photographic, low quality, monochrome',
      denoise_strength: 0.8,
      generation_time: 18.5,
      batch_size: 2,
      batch_index: 1,
      metadata: JSON.stringify({
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Stable Diffusion',
          model: 'sd_xl_base_1.0.safetensors',
          lora_models: ['style_lora:0.7', 'color_enhance:0.3']
        }
      })
    },
    {
      filename: '2024_01_15_152315_test005.jpg',
      original_name: 'midjourney_concept.jpg',
      file_path: `${today}/Origin/2024_01_15_152315_test005.jpg`,
      thumbnail_path: `${today}/thumbnails/2024_01_15_152315_test005.webp`,
      file_size: 2560000,
      mime_type: 'image/jpeg',
      width: 1024,
      height: 1024,
      ai_tool: 'Midjourney',
      model_name: 'Midjourney v6',
      lora_models: null,
      steps: null,
      cfg_scale: null,
      sampler: null,
      seed: 777888999,
      scheduler: null,
      prompt: 'futuristic cityscape, cyberpunk style, neon lights, flying cars, detailed architecture, cinematic lighting --v 6',
      negative_prompt: null,
      denoise_strength: null,
      generation_time: 45.2,
      batch_size: 1,
      batch_index: 0,
      metadata: JSON.stringify({
        extractedAt: new Date().toISOString(),
        ai_info: {
          ai_tool: 'Midjourney',
          model: 'Midjourney v6'
        }
      })
    }
  ];

  try {
    for (const [index, imageData] of testImages.entries()) {
      const stmt = db.prepare(`
        INSERT INTO images (
          filename, original_name, file_path, thumbnail_path,
          file_size, mime_type, width, height, metadata,
          ai_tool, model_name, lora_models, steps, cfg_scale, sampler, seed, scheduler,
          prompt, negative_prompt, denoise_strength, generation_time, batch_size, batch_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        imageData.filename,
        imageData.original_name,
        imageData.file_path,
        imageData.thumbnail_path,
        imageData.file_size,
        imageData.mime_type,
        imageData.width,
        imageData.height,
        imageData.metadata,
        imageData.ai_tool,
        imageData.model_name,
        imageData.lora_models,
        imageData.steps,
        imageData.cfg_scale,
        imageData.sampler,
        imageData.seed,
        imageData.scheduler,
        imageData.prompt,
        imageData.negative_prompt,
        imageData.denoise_strength,
        imageData.generation_time,
        imageData.batch_size,
        imageData.batch_index
      );

      console.log(`✅ 테스트 이미지 ${index + 1}/5 추가됨 (ID: ${info.lastInsertRowid})`);

      // 간단한 더미 파일 생성 (실제 이미지는 아니지만 파일 존재 확인용)
      const dummyContent = `Dummy image file for testing - ${imageData.filename}`;

      await fs.promises.writeFile(
        path.join(testUploadPath, imageData.file_path),
        dummyContent
      );
      await fs.promises.writeFile(
        path.join(testUploadPath, imageData.thumbnail_path),
        dummyContent
      );
    }

    console.log('🎉 테스트 데이터 생성 완료!');
    console.log(`📁 파일 경로: ${testUploadPath}/${today}/`);
    console.log('📊 추가된 데이터:');
    console.log('   - ComfyUI 애니메이션 이미지');
    console.log('   - NovelAI 풍경 이미지');
    console.log('   - Automatic1111 인물 사진');
    console.log('   - Stable Diffusion 추상화');
    console.log('   - Midjourney 컨셉아트');

  } catch (error) {
    console.error('❌ 테스트 데이터 생성 실패:', error);
    throw error;
  }
}

// 직접 실행용
if (require.main === module) {
  const { initializeDatabase } = require('../database/init');

  initializeDatabase()
    .then(() => seedTestData())
    .then(() => {
      console.log('✅ 모든 작업 완료!');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('❌ 작업 실패:', error);
      process.exit(1);
    });
}
