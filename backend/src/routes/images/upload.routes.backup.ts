import { Router, Request, Response } from 'express';
import path from 'path';
import { uploadSingle, uploadMultiple } from '../../middleware/upload';
import { asyncHandler } from '../../middleware/errorHandler';
import { ImageProcessor } from '../../services/imageProcessor';
import { VideoProcessor } from '../../services/videoProcessor';
import { ImageUploadService } from '../../services/imageUploadService';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { ImageMetadataModel } from '../../models/Image/ImageMetadataModel';
import { PromptCollectionService } from '../../services/promptCollectionService';
import { AutoCollectionService } from '../../services/autoCollectionService';
import { imageTaggerService, ImageTaggerService } from '../../services/imageTaggerService';
import { UploadResponse, UploadProgressEvent } from '../../types/image';
import { runtimePaths, toUploadsUrl } from '../../config/runtimePaths';
import { refinePrimaryPrompt } from '@comfyui-image-manager/shared';

const router = Router();
const UPLOAD_BASE_PATH = runtimePaths.uploadsDir;

// 기본 업로드 폴더 ID (watched_folders 테이블에서 조회)
const DEFAULT_UPLOAD_FOLDER_ID = 1;

/**
 * 파일이 동영상인지 확인
 */
function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * 파일이 이미지인지 확인
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * 단일 이미지 업로드
 */
router.post('/upload', uploadSingle, asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const file = files?.['image']?.[0] || files?.['file']?.[0];

  console.log('📤 Upload request received:', {
    file: file ? {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    } : 'No file'
  });

  req.setTimeout(30000, () => {
    console.error('❌ Upload request timeout');
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: 'Upload timeout'
      });
    }
  });

  if (!file) {
    console.log('❌ No file in request');
    return res.status(400).json({
      success: false,
      error: 'No file uploaded'
    } as UploadResponse);
  }

  try {
    let compositeHash: string;
    let processedData: {
      filename: string;
      originalPath: string;
      thumbnailPath: string;
      optimizedPath: string | null;
      width: number;
      height: number;
      fileSize: number;
      metadata?: any;
    };

    // 파일 타입에 따라 분기 처리
    if (isVideoFile(file.mimetype)) {
      console.log('🎬 Processing video...');
      const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
      console.log('✅ Video processed successfully');

      console.log('💾 Saving to database (new structure)...');
      const fullVideoPath = path.join(UPLOAD_BASE_PATH, processedVideo.originalPath);

      // 새 구조로 저장
      compositeHash = await ImageUploadService.saveUploadedImage(
        fullVideoPath,
        {
          width: processedVideo.width,
          height: processedVideo.height,
          thumbnailPath: processedVideo.thumbnailPath,
          optimizedPath: processedVideo.optimizedPath,
          fileSize: processedVideo.fileSize,
          mimeType: file.mimetype,

          // 동영상 메타데이터
          duration: processedVideo.metadata.duration,
          fps: processedVideo.metadata.fps,
          videoCodec: processedVideo.metadata.video_codec,
          audioCodec: processedVideo.metadata.audio_codec,
          bitrate: processedVideo.metadata.bitrate,

          // AI 메타데이터 (동영상은 null)
          aiTool: null,
          modelName: null,
          loraModels: null,
          steps: null,
          cfgScale: null,
          sampler: null,
          seed: null,
          scheduler: null,
          prompt: null,
          negativePrompt: null,
          denoiseStrength: null,
          generationTime: null,
          batchSize: null,
          batchIndex: null,
          autoTags: null
        },
        DEFAULT_UPLOAD_FOLDER_ID
      );

      processedData = processedVideo;
      console.log('✅ Video database save successful, composite_hash:', compositeHash.substring(0, 16) + '...');
    } else if (isImageFile(file.mimetype)) {
      console.log('🔄 Processing image...');
      const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
      console.log('✅ Image processed successfully');

      const aiInfo = processedImage.metadata.ai_info || {};

      // 프롬프트 정제
      let refinedPrompt = aiInfo.prompt || null;
      let refinedNegativePrompt = aiInfo.negative_prompt || null;

      if (refinedPrompt) {
        refinedPrompt = refinePrimaryPrompt(refinedPrompt);
      }

      if (refinedNegativePrompt) {
        refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
      }

      console.log('💾 Saving to database (new structure)...');
      const fullImagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);

      // 새 구조로 저장
      compositeHash = await ImageUploadService.saveUploadedImage(
        fullImagePath,
        {
          width: processedImage.width,
          height: processedImage.height,
          thumbnailPath: processedImage.thumbnailPath,
          optimizedPath: processedImage.optimizedPath,
          fileSize: processedImage.fileSize,
          mimeType: file.mimetype,

          // AI 메타데이터
          aiTool: aiInfo.ai_tool || null,
          modelName: aiInfo.model || null,
          loraModels: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
          steps: aiInfo.steps || null,
          cfgScale: aiInfo.cfg_scale || null,
          sampler: aiInfo.sampler || null,
          seed: aiInfo.seed || null,
          scheduler: aiInfo.scheduler || null,
          prompt: refinedPrompt,
          negativePrompt: refinedNegativePrompt,
          denoiseStrength: aiInfo.denoise_strength || null,
          generationTime: aiInfo.generation_time || null,
          batchSize: aiInfo.batch_size || null,
          batchIndex: aiInfo.batch_index || null,
          autoTags: null,

          // 동영상 메타데이터 (이미지는 null)
          duration: null,
          fps: null,
          videoCodec: null,
          audioCodec: null,
          bitrate: null
        },
        DEFAULT_UPLOAD_FOLDER_ID
      );

      processedData = processedImage;
      console.log('✅ Image database save successful, composite_hash:', compositeHash.substring(0, 16) + '...');

      // 프롬프트 수집
      try {
        console.log('🔍 Collecting prompts...');
        await PromptCollectionService.collectFromImage(
          refinedPrompt,
          refinedNegativePrompt
        );
        console.log('✅ Prompts collected successfully');
      } catch (promptError) {
        console.warn('⚠️ Failed to collect prompts (non-critical):', promptError);
      }
    } else {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }

    // 자동 태깅 (설정에서 활성화된 경우)
    try {
      const { settingsService } = await import('../../services/settingsService');
      const settings = settingsService.loadSettings();

      if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
        console.log('🏷️ Auto-tagging on upload...');
        const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

        let taggerResult;
        if (isVideoFile(file.mimetype)) {
          console.log('🎬 Tagging video (extracting frames)...');
          taggerResult = await imageTaggerService.tagVideo(filePath);
        } else {
          console.log('🖼️ Tagging image...');
          taggerResult = await imageTaggerService.tagImage(filePath);
        }

        if (taggerResult.success) {
          const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
          ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });
          console.log('✅ Auto-tagging completed successfully');
        } else {
          console.warn('⚠️ Auto-tagging failed (non-critical):', taggerResult.error);
        }
      }
    } catch (autoTagError) {
      console.warn('⚠️ Failed to auto-tag file (non-critical):', autoTagError);
    }

    // 자동수집 그룹 처리
    try {
      console.log('🔍 Running auto collection for new file...');
      const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(compositeHash);
      if (autoCollectResults.length > 0) {
        console.log(`✅ File automatically added to ${autoCollectResults.length} groups`);
      }
    } catch (autoCollectError) {
      console.warn('⚠️ Failed to run auto collection (non-critical):', autoCollectError);
    }

    // image_files에서 ID 조회 (응답용 - 레거시 호환성)
    const fileRecords = ImageFileModel.findActiveByHash(compositeHash);
    const fileId = fileRecords.length > 0 ? fileRecords[0].id : 0;

    const response: UploadResponse = {
      success: true,
      data: {
        id: fileId, // file_id 반환 (레거시 호환)
        filename: processedData.filename,
        original_name: file.originalname,
        thumbnail_url: toUploadsUrl(processedData.thumbnailPath)!,
        optimized_url: toUploadsUrl(processedData.optimizedPath)!,
        file_size: processedData.fileSize,
        mime_type: file.mimetype,
        width: processedData.width,
        height: processedData.height,
        upload_date: new Date().toISOString()
      }
    };

    console.log('📨 Sending response...');
    if (!res.headersSent) {
      return res.status(201).json(response);
    }
    return;
  } catch (error) {
    console.error('❌ Upload error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed'
      } as UploadResponse);
    }
    return;
  }
}));

/**
 * 다중 이미지 업로드
 */
router.post('/upload-multiple', uploadMultiple, asyncHandler(async (req: Request, res: Response) => {
  const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
  const files = filesObj?.['images'] || filesObj?.['files'] || [];

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  try {
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        let compositeHash: string;
        let processedData: {
          filename: string;
          originalPath: string;
          thumbnailPath: string;
          optimizedPath: string | null;
          width: number;
          height: number;
          fileSize: number;
          metadata?: any;
        };

        // 파일 타입에 따라 분기 처리
        if (isVideoFile(file.mimetype)) {
          const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
          const fullVideoPath = path.join(UPLOAD_BASE_PATH, processedVideo.originalPath);

          compositeHash = await ImageUploadService.saveUploadedImage(
            fullVideoPath,
            {
              width: processedVideo.width,
              height: processedVideo.height,
              thumbnailPath: processedVideo.thumbnailPath,
              optimizedPath: processedVideo.optimizedPath,
              fileSize: processedVideo.fileSize,
              mimeType: file.mimetype,
              duration: processedVideo.metadata.duration,
              fps: processedVideo.metadata.fps,
              videoCodec: processedVideo.metadata.video_codec,
              audioCodec: processedVideo.metadata.audio_codec,
              bitrate: processedVideo.metadata.bitrate,
              aiTool: null,
              modelName: null,
              loraModels: null,
              steps: null,
              cfgScale: null,
              sampler: null,
              seed: null,
              scheduler: null,
              prompt: null,
              negativePrompt: null,
              denoiseStrength: null,
              generationTime: null,
              batchSize: null,
              batchIndex: null,
              autoTags: null
            },
            DEFAULT_UPLOAD_FOLDER_ID
          );

          processedData = processedVideo;
        } else if (isImageFile(file.mimetype)) {
          const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
          const aiInfo = processedImage.metadata.ai_info || {};

          let refinedPrompt = aiInfo.prompt || null;
          let refinedNegativePrompt = aiInfo.negative_prompt || null;

          if (refinedPrompt) {
            refinedPrompt = refinePrimaryPrompt(refinedPrompt);
          }

          if (refinedNegativePrompt) {
            refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
          }

          const fullImagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);

          compositeHash = await ImageUploadService.saveUploadedImage(
            fullImagePath,
            {
              width: processedImage.width,
              height: processedImage.height,
              thumbnailPath: processedImage.thumbnailPath,
              optimizedPath: processedImage.optimizedPath,
              fileSize: processedImage.fileSize,
              mimeType: file.mimetype,
              aiTool: aiInfo.ai_tool || null,
              modelName: aiInfo.model || null,
              loraModels: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
              steps: aiInfo.steps || null,
              cfgScale: aiInfo.cfg_scale || null,
              sampler: aiInfo.sampler || null,
              seed: aiInfo.seed || null,
              scheduler: aiInfo.scheduler || null,
              prompt: refinedPrompt,
              negativePrompt: refinedNegativePrompt,
              denoiseStrength: aiInfo.denoise_strength || null,
              generationTime: aiInfo.generation_time || null,
              batchSize: aiInfo.batch_size || null,
              batchIndex: aiInfo.batch_index || null,
              autoTags: null,
              duration: null,
              fps: null,
              videoCodec: null,
              audioCodec: null,
              bitrate: null
            },
            DEFAULT_UPLOAD_FOLDER_ID
          );

          console.log('🔍 [Upload Multiple] Saved with composite_hash:', compositeHash.substring(0, 16) + '...');

          // 프롬프트 수집
          try {
            await PromptCollectionService.collectFromImage(
              refinedPrompt,
              refinedNegativePrompt
            );
          } catch (promptError) {
            console.warn('⚠️ Failed to collect prompts for', file.originalname, '(non-critical):', promptError);
          }

          processedData = processedImage;
        } else {
          throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        // 자동 태깅
        try {
          const { settingsService } = await import('../../services/settingsService');
          const settings = settingsService.loadSettings();

          if (settings.tagger.enabled && settings.tagger.autoTagOnUpload) {
            const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

            let taggerResult;
            if (isVideoFile(file.mimetype)) {
              taggerResult = await imageTaggerService.tagVideo(filePath);
            } else {
              taggerResult = await imageTaggerService.tagImage(filePath);
            }

            if (taggerResult.success) {
              const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
              ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });
            }
          }
        } catch (autoTagError) {
          console.warn('⚠️ Failed to auto-tag', file.originalname, '(non-critical):', autoTagError);
        }

        // 자동수집 그룹 처리
        try {
          const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(compositeHash);
          if (autoCollectResults.length > 0) {
            console.log(`✅ ${file.originalname} automatically added to ${autoCollectResults.length} groups`);
          }
        } catch (autoCollectError) {
          console.warn('⚠️ Failed to run auto collection for', file.originalname, '(non-critical):', autoCollectError);
        }

        // image_files에서 ID 조회
        const fileRecords = ImageFileModel.findActiveByHash(compositeHash);
        const fileId = fileRecords.length > 0 ? fileRecords[0].id : 0;

        results.push({
          id: fileId,
          filename: processedData.filename,
          original_name: file.originalname,
          thumbnail_url: toUploadsUrl(processedData.thumbnailPath)!,
          optimized_url: toUploadsUrl(processedData.optimizedPath)!,
          file_size: processedData.fileSize,
          mime_type: file.mimetype,
          width: processedData.width,
          height: processedData.height,
          upload_date: new Date().toISOString()
        });
      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Processing failed'
        });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        uploaded: results,
        failed: errors,
        total: files.length,
        successful: results.length,
        failed_count: errors.length
      }
    });
    return;
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Multiple upload failed'
    });
    return;
  }
}));

/**
 * 다중 이미지 업로드 (Server-Sent Events 스트리밍)
 */
router.post('/upload-multiple-stream', uploadMultiple, async (req: Request, res: Response) => {
  const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
  const files = filesObj?.['images'] || filesObj?.['files'] || [];

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded'
    });
  }

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendProgress = (event: UploadProgressEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // 설정 미리 로드
  let autoTagEnabled = false;
  try {
    const { settingsService } = await import('../../services/settingsService');
    const settings = settingsService.loadSettings();
    autoTagEnabled = settings.tagger.enabled && settings.tagger.autoTagOnUpload;
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }

  // 파일 처리 루프
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const currentFile = i + 1;

    try {
      sendProgress({
        type: 'start',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: `업로드 시작: ${file.originalname}`,
        timestamp: new Date().toISOString()
      });

      let compositeHash: string;
      let processedData: {
        originalPath: string;
        [key: string]: any;
      } | undefined;

      if (isVideoFile(file.mimetype)) {
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'metadata',
          message: '동영상 메타데이터 추출 중...',
          timestamp: new Date().toISOString()
        });

        const processedVideo = await VideoProcessor.processVideo(file, UPLOAD_BASE_PATH);
        const fullVideoPath = path.join(UPLOAD_BASE_PATH, processedVideo.originalPath);

        compositeHash = await ImageUploadService.saveUploadedImage(
          fullVideoPath,
          {
            width: processedVideo.width,
            height: processedVideo.height,
            thumbnailPath: processedVideo.thumbnailPath,
            optimizedPath: processedVideo.optimizedPath,
            fileSize: processedVideo.fileSize,
            mimeType: file.mimetype,
            duration: processedVideo.metadata.duration,
            fps: processedVideo.metadata.fps,
            videoCodec: processedVideo.metadata.video_codec,
            audioCodec: processedVideo.metadata.audio_codec,
            bitrate: processedVideo.metadata.bitrate,
            aiTool: null,
            modelName: null,
            loraModels: null,
            steps: null,
            cfgScale: null,
            sampler: null,
            seed: null,
            scheduler: null,
            prompt: null,
            negativePrompt: null,
            denoiseStrength: null,
            generationTime: null,
            batchSize: null,
            batchIndex: null,
            autoTags: null
          },
          DEFAULT_UPLOAD_FOLDER_ID
        );

        processedData = processedVideo;

        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'thumbnail',
          message: '애니메이션 썸네일 생성 완료',
          timestamp: new Date().toISOString()
        });
      } else if (isImageFile(file.mimetype)) {
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'metadata',
          message: '메타데이터 추출 중...',
          timestamp: new Date().toISOString()
        });

        const processedImage = await ImageProcessor.processImage(file, UPLOAD_BASE_PATH);
        const aiInfo = processedImage.metadata.ai_info || {};

        let refinedPrompt = aiInfo.prompt || null;
        let refinedNegativePrompt = aiInfo.negative_prompt || null;

        if (refinedPrompt) {
          refinedPrompt = refinePrimaryPrompt(refinedPrompt);
        }

        if (refinedNegativePrompt) {
          refinedNegativePrompt = refinePrimaryPrompt(refinedNegativePrompt);
        }

        const fullImagePath = path.join(UPLOAD_BASE_PATH, processedImage.originalPath);

        compositeHash = await ImageUploadService.saveUploadedImage(
          fullImagePath,
          {
            width: processedImage.width,
            height: processedImage.height,
            thumbnailPath: processedImage.thumbnailPath,
            optimizedPath: processedImage.optimizedPath,
            fileSize: processedImage.fileSize,
            mimeType: file.mimetype,
            aiTool: aiInfo.ai_tool || null,
            modelName: aiInfo.model || null,
            loraModels: aiInfo.lora_models ? JSON.stringify(aiInfo.lora_models) : null,
            steps: aiInfo.steps || null,
            cfgScale: aiInfo.cfg_scale || null,
            sampler: aiInfo.sampler || null,
            seed: aiInfo.seed || null,
            scheduler: aiInfo.scheduler || null,
            prompt: refinedPrompt,
            negativePrompt: refinedNegativePrompt,
            denoiseStrength: aiInfo.denoise_strength || null,
            generationTime: aiInfo.generation_time || null,
            batchSize: aiInfo.batch_size || null,
            batchIndex: aiInfo.batch_index || null,
            autoTags: null,
            duration: null,
            fps: null,
            videoCodec: null,
            audioCodec: null,
            bitrate: null
          },
          DEFAULT_UPLOAD_FOLDER_ID
        );

        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'thumbnail',
          message: '썸네일 및 최적화 이미지 생성 완료',
          timestamp: new Date().toISOString()
        });

        // 프롬프트 수집
        try {
          await PromptCollectionService.collectFromImage(
            refinedPrompt,
            refinedNegativePrompt
          );
        } catch (promptError) {
          console.warn('⚠️ Failed to collect prompts for', file.originalname, promptError);
        }

        processedData = processedImage;
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      // 자동 태깅
      if (autoTagEnabled) {
        sendProgress({
          type: 'stage',
          currentFile,
          totalFiles: files.length,
          filename: file.originalname,
          stage: 'auto-tag',
          message: isVideoFile(file.mimetype) ? '동영상 자동 태깅 실행 중 (프레임 추출)...' : '자동 태깅 실행 중...',
          timestamp: new Date().toISOString()
        });

        try {
          if (!processedData) {
            throw new Error('Processed data is not available');
          }

          const filePath = path.join(UPLOAD_BASE_PATH, processedData.originalPath);

          let taggerResult;
          if (isVideoFile(file.mimetype)) {
            taggerResult = await imageTaggerService.tagVideo(filePath);
          } else {
            taggerResult = await imageTaggerService.tagImage(filePath);
          }

          if (taggerResult.success) {
            const autoTagsJson = ImageTaggerService.formatForDatabase(taggerResult);
            ImageMetadataModel.update(compositeHash, { auto_tags: autoTagsJson });
            sendProgress({
              type: 'stage',
              currentFile,
              totalFiles: files.length,
              filename: file.originalname,
              stage: 'auto-tag',
              message: '자동 태깅 완료',
              timestamp: new Date().toISOString()
            });
          } else {
            sendProgress({
              type: 'stage',
              currentFile,
              totalFiles: files.length,
              filename: file.originalname,
              stage: 'auto-tag',
              message: '자동 태깅 실패 (계속 진행)',
              timestamp: new Date().toISOString()
            });
          }
        } catch (autoTagError) {
          console.warn('⚠️ Failed to auto-tag', file.originalname, autoTagError);
        }
      }

      // 자동수집 그룹 처리
      sendProgress({
        type: 'stage',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        stage: 'auto-collect',
        message: '자동 그룹 분류 확인 중...',
        timestamp: new Date().toISOString()
      });

      try {
        const autoCollectResults = await AutoCollectionService.runAutoCollectionForNewImage(compositeHash);
        if (autoCollectResults.length > 0) {
          sendProgress({
            type: 'stage',
            currentFile,
            totalFiles: files.length,
            filename: file.originalname,
            stage: 'auto-collect',
            message: `${autoCollectResults.length}개 그룹에 자동 추가됨`,
            timestamp: new Date().toISOString()
          });
        }
      } catch (autoCollectError) {
        console.warn('⚠️ Failed to run auto collection for', file.originalname, autoCollectError);
      }

      // image_files에서 ID 조회
      const fileRecords = ImageFileModel.findActiveByHash(compositeHash);
      const fileId = fileRecords.length > 0 ? fileRecords[0].id : 0;

      // 완료 이벤트
      sendProgress({
        type: 'complete',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        message: '업로드 완료',
        imageId: fileId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      sendProgress({
        type: 'error',
        currentFile,
        totalFiles: files.length,
        filename: file.originalname,
        error: error instanceof Error ? error.message : 'Processing failed',
        timestamp: new Date().toISOString()
      });
    }
  }

  res.end();
  return;
});

export { router as uploadRoutes };
