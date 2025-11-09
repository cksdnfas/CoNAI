import { GroupModel, ImageGroupModel } from '../models/Group';
import { resolveUploadsPath } from '../config/runtimePaths';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'os';
import { ImageWithFileView } from '../types/image';

export type DownloadType = 'thumbnail' | 'original' | 'video';

interface DownloadOptions {
  groupId: number;
  downloadType: DownloadType;
  compositeHashes?: string[]; // 선택된 이미지만 다운로드 (없으면 전체)
}

interface DownloadResult {
  zipPath: string;
  fileName: string;
  fileCount: number;
}

export class GroupDownloadService {
  /**
   * 그룹 이미지를 ZIP 파일로 생성
   */
  static async createGroupZip(options: DownloadOptions): Promise<DownloadResult> {
    const { groupId, downloadType, compositeHashes } = options;

    // 그룹 정보 조회
    const group = await GroupModel.findById(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // 그룹에 속한 모든 이미지 조회 (파일 정보 포함)
    const allImages = await this.getAllImagesWithFiles(groupId);

    // 선택된 이미지만 필터링 (선택 옵션이 있는 경우)
    let images = allImages;
    if (compositeHashes && compositeHashes.length > 0) {
      images = allImages.filter(img => compositeHashes.includes(img.composite_hash));
    }

    if (images.length === 0) {
      throw new Error('No images found in group');
    }

    // 다운로드 타입에 따라 파일 필터링 및 경로 결정
    const filesToZip = this.prepareFilesToZip(images, downloadType);

    if (filesToZip.length === 0) {
      throw new Error(`No ${downloadType} files found in group`);
    }

    // ZIP 파일 생성
    const zipPath = await this.createZipFile(filesToZip, group.name, downloadType);

    return {
      zipPath,
      fileName: this.generateZipFileName(group.name, downloadType),
      fileCount: filesToZip.length
    };
  }

  /**
   * 그룹의 모든 이미지와 파일 정보 조회 (페이지네이션 없이 전체)
   * composite_hash 기준으로 중복 제거 (해시당 1개만)
   */
  private static async getAllImagesWithFiles(groupId: number): Promise<ImageWithFileView[]> {
    const images: ImageWithFileView[] = [];
    let page = 1;
    const limit = 1000; // 한 번에 1000개씩 조회
    let hasMore = true;

    while (hasMore) {
      const result = await ImageGroupModel.findImagesByGroupWithFiles(groupId, page, limit);
      images.push(...result.images);

      hasMore = result.images.length === limit;
      page++;
    }

    // 중복 제거: composite_hash당 첫 번째 파일만 선택
    // LEFT JOIN image_files로 인해 같은 해시의 여러 파일이 조인될 수 있음
    const uniqueImages = new Map<string, ImageWithFileView>();
    for (const img of images) {
      if (!uniqueImages.has(img.composite_hash)) {
        uniqueImages.set(img.composite_hash, img);
      }
    }

    return Array.from(uniqueImages.values());
  }

  /**
   * 다운로드 타입에 따라 ZIP에 포함할 파일 목록 준비
   */
  private static prepareFilesToZip(
    images: ImageWithFileView[],
    downloadType: DownloadType
  ): Array<{ filePath: string; originalName: string; compositeHash: string }> {
    const filesToZip: Array<{ filePath: string; originalName: string; compositeHash: string }> = [];
    const usedNames = new Map<string, number>(); // 파일명 중복 카운터

    for (const image of images) {
      let filePath: string | null = null;
      let fileExtension = '.jpg'; // 기본 확장자

      if (downloadType === 'thumbnail') {
        // 썸네일 다운로드
        if (image.thumbnail_path) {
          filePath = resolveUploadsPath(image.thumbnail_path);
          fileExtension = path.extname(image.thumbnail_path) || '.jpg';
        }
      } else if (downloadType === 'original') {
        // 원본 이미지 다운로드 (image, animated 타입만)
        // video 타입은 제외
        if (image.original_file_path) {
          const fullPath = resolveUploadsPath(image.original_file_path);

          // 파일 타입 확인 (확장자로 간접 확인)
          const ext = path.extname(image.original_file_path).toLowerCase();
          const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext);

          if (!isVideo) {
            filePath = fullPath;
            fileExtension = ext || '.jpg';
          }
        }

        // 원본 파일이 없으면 썸네일로 대체
        if (!filePath && image.thumbnail_path) {
          filePath = resolveUploadsPath(image.thumbnail_path);
          fileExtension = path.extname(image.thumbnail_path) || '.jpg';
        }
      } else if (downloadType === 'video') {
        // 동영상 및 애니메이트 다운로드 (video, animated 타입만)
        if (image.original_file_path) {
          const fullPath = resolveUploadsPath(image.original_file_path);
          const ext = path.extname(image.original_file_path).toLowerCase();

          // 동영상 또는 GIF 파일만
          const isVideoOrAnimated = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.gif'].includes(ext);

          if (isVideoOrAnimated) {
            filePath = fullPath;
            fileExtension = ext;
          }
        }
      }

      // 파일이 실제로 존재하는지 확인
      if (filePath && fs.existsSync(filePath)) {
        // 원본 파일명 추출 (있으면)
        let baseName = 'image';
        if (image.original_file_path) {
          baseName = path.basename(image.original_file_path, path.extname(image.original_file_path));
        }

        // 파일명 중복 처리
        const finalName = this.getUniqueFileName(baseName, fileExtension, usedNames);

        filesToZip.push({
          filePath,
          originalName: finalName,
          compositeHash: image.composite_hash
        });
      }
    }

    return filesToZip;
  }

  /**
   * 중복되지 않는 고유한 파일명 생성
   */
  private static getUniqueFileName(
    baseName: string,
    extension: string,
    usedNames: Map<string, number>
  ): string {
    const baseNameWithExt = `${baseName}${extension}`;

    if (!usedNames.has(baseNameWithExt)) {
      usedNames.set(baseNameWithExt, 1);
      return baseNameWithExt;
    }

    // 중복된 경우 _001, _002 형식으로 번호 추가
    const count = usedNames.get(baseNameWithExt)!;
    usedNames.set(baseNameWithExt, count + 1);

    const paddedCount = String(count).padStart(3, '0');
    return `${baseName}_${paddedCount}${extension}`;
  }

  /**
   * ZIP 파일 생성
   */
  private static async createZipFile(
    files: Array<{ filePath: string; originalName: string }>,
    groupName: string,
    downloadType: DownloadType
  ): Promise<string> {
    const zip = new AdmZip();

    // 파일들을 ZIP에 추가
    for (const file of files) {
      try {
        zip.addLocalFile(file.filePath, '', file.originalName);
      } catch (error) {
        console.warn(`Failed to add file to zip: ${file.filePath}`, error);
        // 개별 파일 실패 시 계속 진행
      }
    }

    // 임시 파일로 ZIP 저장
    const tempDir = tmpdir();
    const zipFileName = this.generateZipFileName(groupName, downloadType);
    const zipPath = path.join(tempDir, zipFileName);

    zip.writeZip(zipPath);

    return zipPath;
  }

  /**
   * ZIP 파일명 생성
   */
  private static generateZipFileName(groupName: string, downloadType: DownloadType): string {
    // 파일명에 사용할 수 없는 문자 제거
    const sanitizedName = groupName.replace(/[<>:"/\\|?*]/g, '_');

    // 다운로드 타입 한글 변환
    let typeLabel = '';
    switch (downloadType) {
      case 'thumbnail':
        typeLabel = 'thumbnail';
        break;
      case 'original':
        typeLabel = 'original';
        break;
      case 'video':
        typeLabel = 'video';
        break;
    }

    // 날짜 형식: YYYY-MM-DD
    const date = new Date().toISOString().split('T')[0];

    return `${sanitizedName}_${typeLabel}_${date}.zip`;
  }

  /**
   * 임시 ZIP 파일 삭제 (다운로드 완료 후 정리)
   */
  static async cleanupTempFile(zipPath: string): Promise<void> {
    try {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    } catch (error) {
      console.warn(`Failed to cleanup temp zip file: ${zipPath}`, error);
    }
  }

  /**
   * 그룹의 파일 타입별 개수 조회
   */
  static async getFileCountByType(groupId: number): Promise<{
    thumbnail: number;
    original: number;
    video: number;
  }> {
    const images = await this.getAllImagesWithFiles(groupId);

    let thumbnailCount = 0;
    let originalCount = 0;
    let videoCount = 0;

    for (const image of images) {
      // 썸네일 개수
      if (image.thumbnail_path) {
        const thumbPath = resolveUploadsPath(image.thumbnail_path);
        if (fs.existsSync(thumbPath)) {
          thumbnailCount++;
        }
      }

      // 원본 이미지 개수
      if (image.original_file_path) {
        const fullPath = resolveUploadsPath(image.original_file_path);
        const ext = path.extname(image.original_file_path).toLowerCase();
        const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext);
        const isAnimated = ext === '.gif';

        if (fs.existsSync(fullPath)) {
          if (isVideo || isAnimated) {
            videoCount++;
          } else {
            originalCount++;
          }
        }
      } else if (image.thumbnail_path) {
        // 원본 없으면 썸네일로 카운트
        const thumbPath = resolveUploadsPath(image.thumbnail_path);
        if (fs.existsSync(thumbPath)) {
          originalCount++;
        }
      }
    }

    return { thumbnail: thumbnailCount, original: originalCount, video: videoCount };
  }
}
