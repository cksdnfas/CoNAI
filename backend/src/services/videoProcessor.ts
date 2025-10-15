import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
const ffprobeStatic = require('ffprobe-static');

export interface VideoMetadata {
  duration: number;          // 초 단위
  width: number;
  height: number;
  fps: number;               // 프레임 레이트
  video_codec: string;       // 비디오 코덱
  audio_codec: string | null; // 오디오 코덱 (없을 수 있음)
  bitrate: number;           // 비트레이트 (kbps)
  format: string;            // 포맷 (mp4, webm 등)
  extractedAt: string;
  frame_count?: number;      // 추출된 프레임 수
  thumbnail_type?: string;   // 썸네일 타입 (예: 'animated-webp')
  thumbnail_frame_rate?: number; // 썸네일 재생 속도 (fps)
}

export interface ProcessedVideo {
  filename: string;
  originalPath: string;
  thumbnailPath: string;
  optimizedPath: string | null;  // 향후 동영상 최적화 버전용
  width: number;
  height: number;
  fileSize: number;
  metadata: VideoMetadata;
}

export interface ThumbnailOptions {
  timestamp?: number;        // 추출할 시간 (초), 기본값: 중간 지점
  width?: number;            // 썸네일 최대 너비, 기본값: 1080
  quality?: number;          // WebP 품질, 기본값: 80
  format?: 'webp' | 'jpg';   // 출력 포맷, 기본값: webp
}

export class VideoProcessor {
  private static readonly THUMBNAIL_SIZE = 1080;
  private static readonly THUMBNAIL_QUALITY = 80;

  /**
   * Get FFmpeg binary path (bundled or system)
   */
  private static getFFmpegPath(): string {
    return ffmpegPath || 'ffmpeg';
  }

  /**
   * Get FFprobe binary path (bundled or system)
   */
  private static getFFprobePath(): string {
    return ffprobeStatic.path || 'ffprobe';
  }

  /**
   * 상대 경로 정규화
   */
  private static normalizeRelativePath(targetPath: string, basePath: string): string {
    return path.relative(basePath, targetPath).replace(/\\/g, '/');
  }

  /**
   * 날짜 기반 폴더 경로 생성
   */
  static getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 업로드 폴더 구조 생성 (동영상 전용)
   * 경로: uploads/videos/YYYY-MM-DD/Origin|optimized/
   * optimized 폴더 내에 동영상명으로 서브폴더 생성
   */
  static async createUploadFolders(
    baseUploadPath: string,
    videoFilename: string
  ): Promise<{
    dateFolder: string;
    originFolder: string;
    optimizedFolder: string;
    framesFolder: string;
  }> {
    const dateFolder = this.getDateFolder();
    // 동영상은 videos 서브폴더 사용
    const videosPath = path.join(baseUploadPath, 'videos');
    const dateFolderPath = path.join(videosPath, dateFolder);
    const originFolder = path.join(dateFolderPath, 'Origin');
    const optimizedFolder = path.join(dateFolderPath, 'optimized');

    // 동영상명(확장자 제외)으로 서브폴더 생성
    const videoBaseName = path.parse(videoFilename).name;
    const framesFolder = path.join(optimizedFolder, videoBaseName);

    // 폴더 생성
    await fs.promises.mkdir(originFolder, { recursive: true });
    await fs.promises.mkdir(framesFolder, { recursive: true });

    return {
      dateFolder: path.join('videos', dateFolder),
      originFolder,
      optimizedFolder,
      framesFolder
    };
  }

  /**
   * 고유한 파일명 생성
   */
  static generateUniqueFilename(originalName: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(originalName);

    return `${year}_${month}_${day}_${hour}${minute}${second}_${random}${ext}`;
  }

  /**
   * FFmpeg 사용 여부 확인
   */
  static async checkFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpegCmd = this.getFFmpegPath();
      const ffmpeg = spawn(ffmpegCmd, ['-version']);
      ffmpeg.on('error', () => resolve(false));
      ffmpeg.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * FFprobe를 사용하여 동영상 메타데이터 추출
   */
  static async extractMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const ffprobeCmd = this.getFFprobePath();
      const ffprobe = spawn(ffprobeCmd, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ]);

      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const data = JSON.parse(stdout);

          // 비디오 스트림 찾기
          const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
          // 오디오 스트림 찾기
          const audioStream = data.streams.find((s: any) => s.codec_type === 'audio');

          if (!videoStream) {
            reject(new Error('No video stream found'));
            return;
          }

          // FPS 계산
          let fps = 0;
          if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
            fps = den > 0 ? num / den : 0;
          }

          const metadata: VideoMetadata = {
            duration: parseFloat(data.format.duration) || 0,
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            fps: Math.round(fps * 100) / 100,
            video_codec: videoStream.codec_name || 'unknown',
            audio_codec: audioStream ? audioStream.codec_name : null,
            bitrate: parseInt(data.format.bit_rate) / 1000 || 0, // kbps로 변환
            format: data.format.format_name || 'unknown',
            extractedAt: new Date().toISOString()
          };

          resolve(metadata);
        } catch (error) {
          reject(new Error(`Failed to parse FFprobe output: ${error}`));
        }
      });

      ffprobe.on('error', (error) => {
        reject(new Error(`Failed to spawn FFprobe: ${error.message}`));
      });
    });
  }

  /**
   * [DEPRECATED] 단일 프레임 썸네일 생성 (레거시)
   * 새로운 동영상 처리는 애니메이션 WebP를 사용합니다.
   * 이 메서드는 향후 제거될 예정입니다.
   */
  static async generateThumbnail(
    videoPath: string,
    outputPath: string,
    options: ThumbnailOptions = {}
  ): Promise<void> {
    const {
      timestamp,
      width = this.THUMBNAIL_SIZE,
      quality = this.THUMBNAIL_QUALITY,
      format = 'webp'
    } = options;

    // 임시 파일 경로 (FFmpeg는 jpg/png 출력)
    const tempOutputPath = outputPath.replace(/\.\w+$/, '.png');

    return new Promise(async (resolve, reject) => {
      try {
        // 메타데이터 추출하여 적절한 timestamp 계산
        let seekTime = '00:00:01'; // 기본값: 1초

        if (timestamp !== undefined) {
          // 사용자 지정 시간
          seekTime = this.formatTime(timestamp);
        } else {
          // 중간 지점 계산
          try {
            const metadata = await this.extractMetadata(videoPath);
            const middleTime = metadata.duration / 2;
            seekTime = this.formatTime(middleTime);
          } catch (error) {
            console.warn('Failed to get video duration, using default timestamp:', error);
          }
        }

        const ffmpegCmd = this.getFFmpegPath();
        const ffmpeg = spawn(ffmpegCmd, [
          '-ss', seekTime,              // 추출 시간
          '-i', videoPath,              // 입력 파일
          '-vframes', '1',              // 1 프레임만
          '-vf', `scale=${width}:-1`,   // 너비 제한, 비율 유지
          '-y',                         // 덮어쓰기
          tempOutputPath
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', async (code) => {
          if (code !== 0) {
            reject(new Error(`FFmpeg thumbnail generation failed with code ${code}: ${stderr}`));
            return;
          }

          try {
            // Sharp를 사용하여 WebP로 변환 및 최적화
            if (format === 'webp') {
              await sharp(tempOutputPath)
                .webp({ quality, effort: 4 })
                .toFile(outputPath);

              // 임시 파일 삭제
              if (fs.existsSync(tempOutputPath)) {
                await fs.promises.unlink(tempOutputPath);
              }
            } else {
              // PNG/JPG는 그대로 사용
              if (tempOutputPath !== outputPath) {
                await fs.promises.rename(tempOutputPath, outputPath);
              }
            }

            resolve();
          } catch (error) {
            reject(new Error(`Failed to process thumbnail: ${error}`));
          }
        });

        ffmpeg.on('error', (error) => {
          reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 시간을 HH:MM:SS 포맷으로 변환
   */
  private static formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * 동영상에서 프레임 추출
   * - 1분 이하: 1초당 1장 (1 fps)
   * - 1분 초과: 5초당 1장 (0.2 fps)
   */
  static async extractFrames(
    videoPath: string,
    outputFolder: string,
    duration: number
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      try {
        // 추출 프레임 레이트 결정
        const fps = duration <= 60 ? '1' : '1/5'; // 1초당 1장 or 5초당 1장

        // 출력 파일 패턴
        const outputPattern = path.join(outputFolder, 'frame_%04d.webp');

        const ffmpegCmd = this.getFFmpegPath();
        const ffmpeg = spawn(ffmpegCmd, [
          '-i', videoPath,                    // 입력 파일
          '-vf', `fps=${fps}`,                // 프레임 레이트 필터
          '-q:v', '5',                        // WebP 품질 (1-100, 낮을수록 고품질, 5 ≈ 95%)
          '-compression_level', '4',          // 압축 레벨 (0-6, 4는 균형)
          '-y',                               // 덮어쓰기
          outputPattern
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', async (code) => {
          if (code !== 0) {
            reject(new Error(`FFmpeg frame extraction failed with code ${code}: ${stderr}`));
            return;
          }

          try {
            // 생성된 프레임 파일 목록 가져오기
            const files = await fs.promises.readdir(outputFolder);
            const frameFiles = files
              .filter(f => f.startsWith('frame_') && f.endsWith('.webp'))
              .sort()
              .map(f => path.join(outputFolder, f));

            console.log(`✅ Extracted ${frameFiles.length} frames from video`);
            resolve(frameFiles);
          } catch (error) {
            reject(new Error(`Failed to read extracted frames: ${error}`));
          }
        });

        ffmpeg.on('error', (error) => {
          reject(new Error(`Failed to spawn FFmpeg for frame extraction: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 애니메이션 WebP 생성
   * 0.5초 간격으로 프레임 재생 (delay: 500ms)
   */
  static async createAnimatedWebP(
    frameFiles: string[],
    outputPath: string,
    quality: number = 95
  ): Promise<void> {
    try {
      if (frameFiles.length === 0) {
        throw new Error('No frames provided for animated WebP creation');
      }

      console.log(`🎬 Creating animated WebP from ${frameFiles.length} frames...`);

      // Sharp에서 애니메이션 WebP 생성
      // 첫 번째 프레임을 기준으로 시작
      const images = await Promise.all(
        frameFiles.map(async (framePath) => {
          return await fs.promises.readFile(framePath);
        })
      );

      // Sharp를 사용하여 애니메이션 WebP 생성
      // Sharp의 animated 옵션은 input이 GIF일 때만 자동으로 처리되므로
      // 여러 프레임을 합치는 작업은 FFmpeg로 처리하는 것이 더 효율적

      // FFmpeg로 애니메이션 WebP 생성
      return new Promise((resolve, reject) => {
        // 입력 파일 패턴
        const inputPattern = path.join(path.dirname(frameFiles[0]), 'frame_%04d.webp');

        const ffmpegCmd = VideoProcessor.getFFmpegPath();
        const ffmpeg = spawn(ffmpegCmd, [
          '-framerate', '2',                  // 2 fps = 0.5초 간격
          '-i', inputPattern,                 // 입력 패턴
          '-loop', '0',                       // 무한 반복
          '-q:v', String(100 - quality),      // 품질 (0-100, 낮을수록 고품질)
          '-y',                               // 덮어쓰기
          outputPath
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`FFmpeg animated WebP creation failed with code ${code}: ${stderr}`));
            return;
          }

          console.log(`✅ Animated WebP created successfully: ${outputPath}`);
          resolve();
        });

        ffmpeg.on('error', (error) => {
          reject(new Error(`Failed to spawn FFmpeg for animated WebP: ${error.message}`));
        });
      });
    } catch (error) {
      throw new Error(`Failed to create animated WebP: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 메인 동영상 처리 함수
   * 프레임 추출 → 애니메이션 WebP 생성 → 임시 파일 정리
   */
  static async processVideo(
    file: Express.Multer.File,
    baseUploadPath: string,
    thumbnailOptions?: ThumbnailOptions
  ): Promise<ProcessedVideo> {
    let tempFilePath: string | undefined;
    let framesFolder: string | undefined;

    try {
      // FFmpeg 사용 가능 확인
      const ffmpegAvailable = await this.checkFFmpegAvailable();
      if (!ffmpegAvailable) {
        throw new Error('FFmpeg is not available. Please install FFmpeg to process videos.');
      }

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);

      // 폴더 구조 생성 (동영상명 기반)
      const folders = await this.createUploadFolders(baseUploadPath, filename);
      framesFolder = folders.framesFolder;

      const originalPath = path.join(folders.originFolder, filename);

      // 썸네일 파일명 (애니메이션 WebP)
      const thumbnailFilename = `${path.parse(filename).name}_animated.webp`;
      const thumbnailPath = path.join(folders.framesFolder, thumbnailFilename);

      // diskStorage: 임시 파일 복사
      if (file.path) {
        tempFilePath = file.path;
        await fs.promises.copyFile(file.path, originalPath);
      } else if (file.buffer) {
        // memoryStorage (레거시): 버퍼에서 저장
        await fs.promises.writeFile(originalPath, file.buffer);
      } else {
        throw new Error('No file data available (neither path nor buffer)');
      }

      // 메타데이터 추출
      const metadata = await this.extractMetadata(originalPath);
      console.log(`📊 Video metadata: ${metadata.duration}s, ${metadata.width}x${metadata.height}`);

      // 1. 프레임 추출
      console.log('🎞️ Extracting frames from video...');
      const frameFiles = await this.extractFrames(
        originalPath,
        folders.framesFolder,
        metadata.duration
      );

      if (frameFiles.length === 0) {
        throw new Error('No frames were extracted from the video');
      }

      // 2. 애니메이션 WebP 생성
      console.log('🎬 Creating animated WebP thumbnail...');
      await this.createAnimatedWebP(
        frameFiles,
        thumbnailPath,
        95 // 95% 품질
      );

      // 3. 개별 프레임 파일 삭제 (애니메이션 WebP만 남김)
      console.log('🧹 Cleaning up temporary frame files...');
      await Promise.all(
        frameFiles.map(async (framePath) => {
          try {
            await fs.promises.unlink(framePath);
          } catch (error) {
            console.warn(`Failed to delete frame file: ${framePath}`, error);
          }
        })
      );
      console.log(`✅ Cleaned up ${frameFiles.length} temporary frame files`);

      // 메타데이터 업데이트
      metadata.frame_count = frameFiles.length;
      metadata.thumbnail_type = 'animated-webp';
      metadata.thumbnail_frame_rate = 2; // 2 fps (0.5초 간격)

      const relativeOriginal = this.normalizeRelativePath(originalPath, baseUploadPath);
      const relativeThumbnail = this.normalizeRelativePath(thumbnailPath, baseUploadPath);

      return {
        filename,
        originalPath: relativeOriginal,
        thumbnailPath: relativeThumbnail,
        optimizedPath: null, // 향후 동영상 최적화 버전용
        width: metadata.width,
        height: metadata.height,
        fileSize: file.size,
        metadata
      };
    } catch (error) {
      console.error('Video processing failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';

      // 오류 발생 시 프레임 폴더 정리
      if (framesFolder && fs.existsSync(framesFolder)) {
        try {
          const files = await fs.promises.readdir(framesFolder);
          await Promise.all(
            files.map(f => fs.promises.unlink(path.join(framesFolder!, f)))
          );
          await fs.promises.rmdir(framesFolder);
          console.log('🧹 Cleaned up frames folder after error');
        } catch (cleanupError) {
          console.warn('Failed to cleanup frames folder:', cleanupError);
        }
      }

      throw new Error(`Video processing failed: ${message}`);
    } finally {
      // 임시 파일 정리
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp file:', tempFilePath, cleanupError);
        }
      }
    }
  }

  /**
   * 동영상 파일 삭제
   */
  static async deleteVideoFiles(
    originalPath: string,
    thumbnailPath: string,
    optimizedPath: string | null,
    baseUploadPath: string
  ): Promise<void> {
    try {
      const fullOriginalPath = path.join(baseUploadPath, originalPath);
      const fullThumbnailPath = path.join(baseUploadPath, thumbnailPath);

      const deletePromises = [];

      if (fs.existsSync(fullOriginalPath)) {
        deletePromises.push(fs.promises.unlink(fullOriginalPath));
      }

      if (fs.existsSync(fullThumbnailPath)) {
        deletePromises.push(fs.promises.unlink(fullThumbnailPath));
      }

      if (optimizedPath) {
        const fullOptimizedPath = path.join(baseUploadPath, optimizedPath);
        if (fs.existsSync(fullOptimizedPath)) {
          deletePromises.push(fs.promises.unlink(fullOptimizedPath));
        }
      }

      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to delete video files:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while deleting files');
    }
  }
}
