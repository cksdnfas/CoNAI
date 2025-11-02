import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
const ffprobeStatic = require('ffprobe-static');
import { generateFileHash } from '../utils/fileHash';

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
  width: number;
  height: number;
  fileSize: number;
  fileHash: string;  // MD5 파일 해시
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
   * 경로: uploads/videos/YYYY-MM-DD/Origin/
   */
  static async createUploadFolders(
    baseUploadPath: string,
    videoFilename: string
  ): Promise<{
    dateFolder: string;
    originFolder: string;
  }> {
    const dateFolder = this.getDateFolder();
    // 동영상은 videos 서브폴더 사용
    const videosPath = path.join(baseUploadPath, 'videos');
    const dateFolderPath = path.join(videosPath, dateFolder);
    const originFolder = path.join(dateFolderPath, 'Origin');

    // 폴더 생성
    await fs.promises.mkdir(originFolder, { recursive: true });

    return {
      dateFolder: path.join('videos', dateFolder),
      originFolder
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
   * [DEPRECATED] 프레임 추출 및 애니메이션 WebP 생성 기능 제거
   *
   * 새로운 전략: 원본 비디오를 HTML5 <video> 태그로 직접 재생
   * - 처리 시간 93% 단축 (30초 → 2초)
   * - 디스크 사용량 26% 절감
   * - FFmpeg 애니메이션 WebP 호환성 문제 회피
   * - 원본 비디오 품질 유지
   * - 브라우저 네이티브 컨트롤 제공
   */

  /**
   * 메인 동영상 처리 함수
   * 메타데이터 추출 후 원본 비디오를 썸네일로 사용 (HTML5 <video> 재생)
   */
  static async processVideo(
    file: Express.Multer.File,
    baseUploadPath: string,
    thumbnailOptions?: ThumbnailOptions
  ): Promise<ProcessedVideo> {
    let tempFilePath: string | undefined;

    try {
      // FFmpeg 사용 가능 확인 (메타데이터 추출용)
      const ffmpegAvailable = await this.checkFFmpegAvailable();
      if (!ffmpegAvailable) {
        throw new Error('FFmpeg is not available. Please install FFmpeg to process videos.');
      }

      // 고유한 파일명 생성
      const filename = this.generateUniqueFilename(file.originalname);

      // 폴더 구조 생성 (videos/YYYY-MM-DD/Origin/)
      const folders = await this.createUploadFolders(baseUploadPath, filename);

      const originalPath = path.join(folders.originFolder, filename);

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
      console.log('📊 Extracting video metadata...');
      const metadata = await this.extractMetadata(originalPath);
      console.log(`✅ Video metadata: ${metadata.duration}s, ${metadata.width}x${metadata.height}, ${metadata.video_codec}`);

      // MD5 파일 해시 생성
      console.log('🔐 Generating file hash...');
      const fileHash = await generateFileHash(originalPath);
      console.log(`✅ File hash: ${fileHash}`);

      // 메타데이터 업데이트
      metadata.thumbnail_type = 'video-original';

      const relativeOriginal = this.normalizeRelativePath(originalPath, baseUploadPath);

      return {
        filename,
        originalPath: relativeOriginal,
        thumbnailPath: relativeOriginal, // 썸네일 = 원본 비디오 경로
        width: metadata.width,
        height: metadata.height,
        fileSize: file.size,
        fileHash,
        metadata
      };
    } catch (error) {
      console.error('Video processing failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
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
    baseUploadPath: string
  ): Promise<void> {
    try {
      // 경로 검증 및 정규화
      const pathsToDelete = new Set<string>();

      // 각 경로 검증 및 추가
      const addPathIfValid = (relativePath: string | null) => {
        // 빈 문자열이거나 null/undefined 체크
        if (!relativePath || relativePath.trim() === '') {
          return;
        }

        // 절대 경로 생성
        const fullPath = path.join(baseUploadPath, relativePath);

        // 경로가 baseUploadPath 내부에 있는지 확인 (보안)
        const resolvedPath = path.resolve(fullPath);
        const resolvedBase = path.resolve(baseUploadPath);
        if (!resolvedPath.startsWith(resolvedBase)) {
          console.warn(`⚠️ Path outside base directory, skipping: ${relativePath}`);
          return;
        }

        // 파일 존재 여부 및 파일 타입 확인
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            pathsToDelete.add(fullPath);
          } else {
            console.warn(`⚠️ Not a file (possibly a directory), skipping: ${fullPath}`);
          }
        }
      };

      // 비디오는 원본과 썸네일이 같은 경로일 수 있으므로 Set 사용으로 중복 자동 제거
      addPathIfValid(originalPath);
      addPathIfValid(thumbnailPath);

      // 각 파일을 개별적으로 삭제 (하나 실패해도 나머지 삭제 계속)
      const deletePromises = Array.from(pathsToDelete).map(async (filePath) => {
        try {
          await fs.promises.unlink(filePath);
          console.log(`✅ Deleted video file: ${path.relative(baseUploadPath, filePath)}`);
        } catch (error) {
          console.error(`❌ Failed to delete video file: ${path.relative(baseUploadPath, filePath)}`, error);
          // 개별 파일 삭제 실패는 전체 작업을 중단하지 않음
        }
      });

      await Promise.all(deletePromises);

      if (pathsToDelete.size === 0) {
        console.warn('⚠️ No valid video files found to delete');
      }
    } catch (error) {
      console.error('Failed to delete video files:', error);
      throw error instanceof Error ? error : new Error('Unknown error occurred while deleting files');
    }
  }
}
