import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'os';
import { ImageWithFileView } from '../types/image';

export type DownloadType = 'thumbnail' | 'original' | 'video';
export type GroupType = 'custom' | 'auto-folder';
export type CaptionMode = 'auto_tags' | 'merged';

interface DownloadOptions {
  groupId: number;
  downloadType: DownloadType;
  groupType: GroupType; // 그룹 타입 추가
  compositeHashes?: string[]; // 선택된 이미지만 다운로드 (없으면 전체)
  captionOptions?: {
    captionMode: CaptionMode; // 'auto_tags': taglist만, 'merged': taglist + prompt 병합
  };
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
    const { groupId, downloadType, groupType, compositeHashes, captionOptions } = options;

    // 그룹 정보 조회
    let groupName: string;
    if (groupType === 'custom') {
      const group = await GroupModel.findById(groupId);
      if (!group) {
        throw new Error('Group not found');
      }
      groupName = group.name;
    } else {
      const group = await AutoFolderGroupModel.findById(groupId);
      if (!group) {
        throw new Error('Auto-folder group not found');
      }
      groupName = group.folder_path;
    }

    // 그룹에 속한 모든 이미지 조회 (파일 정보 포함)
    const allImages = await this.getAllImagesWithFiles(groupId, groupType);

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

    // 캡션 옵션이 있으면 각 파일에 캡션 텍스트 생성
    if (captionOptions) {
      const imageMap = new Map(images.map(img => [img.composite_hash, img]));
      for (const file of filesToZip) {
        const image = imageMap.get(file.compositeHash);
        if (image) {
          file.captionContent = this.generateCaptionContent(image, captionOptions.captionMode);
        }
      }
    }

    // ZIP 파일명 레이블 결정
    const zipLabel = captionOptions ? 'lora-dataset' : downloadType;

    // ZIP 파일 생성
    const zipPath = await this.createZipFile(filesToZip, groupName, zipLabel);

    return {
      zipPath,
      fileName: this.generateZipFileName(groupName, zipLabel),
      fileCount: filesToZip.length
    };
  }

  /**
   * 그룹의 모든 이미지와 파일 정보 조회 (페이지네이션 없이 전체)
   * composite_hash 기준으로 중복 제거 (해시당 1개만)
   */
  private static async getAllImagesWithFiles(groupId: number, groupType: GroupType): Promise<ImageWithFileView[]> {
    const images: ImageWithFileView[] = [];
    let page = 1;
    const limit = 1000; // 한 번에 1000개씩 조회
    let hasMore = true;

    if (groupType === 'custom') {
      // 커스텀 그룹: image_groups 테이블 사용
      while (hasMore) {
        const result = await ImageGroupModel.findImagesByGroupWithFiles(groupId, page, limit);
        images.push(...result.images);

        hasMore = result.images.length === limit;
        page++;
      }
    } else {
      // 자동 폴더 그룹: auto_folder_group_images 테이블 사용
      while (hasMore) {
        const pageImages = await AutoFolderGroupImageModel.findPreviewImages(groupId, limit, false);
        images.push(...pageImages);

        hasMore = pageImages.length === limit;
        page++;

        // 더 이상 데이터가 없으면 종료
        if (pageImages.length < limit) {
          hasMore = false;
        }
      }
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
  ): Array<{ filePath: string; originalName: string; compositeHash: string; captionContent?: string }> {
    const filesToZip: Array<{ filePath: string; originalName: string; compositeHash: string; captionContent?: string }> = [];
    const usedNames = new Map<string, number>(); // 파일명 중복 카운터

    for (const image of images) {
      let filePath: string | null = null;
      let fileExtension = '.jpg'; // 기본 확장자

      if (downloadType === 'thumbnail') {
        // 썸네일 다운로드
        if (image.thumbnail_path) {
          filePath = path.join(runtimePaths.tempDir, image.thumbnail_path);
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
          filePath = path.join(runtimePaths.tempDir, image.thumbnail_path);
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
      } else {
        // 디버깅: 파일을 찾지 못한 경우 로그
        console.warn(`[GroupDownload] File not found for ${downloadType}:`, {
          composite_hash: image.composite_hash,
          filePath,
          thumbnail_path: image.thumbnail_path,
          original_file_path: image.original_file_path,
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
    files: Array<{ filePath: string; originalName: string; captionContent?: string }>,
    groupName: string,
    typeLabel: string
  ): Promise<string> {
    const zip = new AdmZip();

    // 파일들을 ZIP에 추가
    for (const file of files) {
      try {
        zip.addLocalFile(file.filePath, '', file.originalName);

        // 캡션 .txt 파일 추가 (LoRA 데이터셋용)
        if (file.captionContent !== undefined) {
          const txtName = file.originalName.replace(/\.[^.]+$/, '.txt');
          zip.addFile(txtName, Buffer.from(file.captionContent, 'utf-8'));
        }
      } catch (error) {
        console.warn(`Failed to add file to zip: ${file.filePath}`, error);
        // 개별 파일 실패 시 계속 진행
      }
    }

    // 임시 파일로 ZIP 저장
    const tempDir = tmpdir();
    const zipFileName = this.generateZipFileName(groupName, typeLabel);
    const zipPath = path.join(tempDir, zipFileName);

    zip.writeZip(zipPath);

    return zipPath;
  }

  /**
   * ZIP 파일명 생성
   */
  private static generateZipFileName(groupName: string, typeLabel: string): string {
    // 파일명에 사용할 수 없는 문자 제거
    const sanitizedName = groupName.replace(/[<>:"/\\|?*]/g, '_');

    // 날짜 형식: YYYY-MM-DD
    const date = new Date().toISOString().split('T')[0];

    return `${sanitizedName}_${typeLabel}_${date}.zip`;
  }

  /**
   * LoRA 학습용 캡션 텍스트 생성
   * auto_tags의 taglist를 기본으로, merged 모드에서는 prompt 태그도 병합 (중복 제거)
   */
  private static generateCaptionContent(image: ImageWithFileView, captionMode: CaptionMode): string {
    // auto_tags에서 taglist 추출
    let taglistTokens: string[] = [];
    if (image.auto_tags) {
      try {
        const parsed = JSON.parse(image.auto_tags);
        if (parsed.taglist) {
          taglistTokens = parsed.taglist.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
        }
      } catch {
        // JSON 파싱 실패 시 빈 배열
      }
    }

    if (captionMode === 'auto_tags') {
      return taglistTokens.join(', ');
    }

    // merged 모드: taglist + prompt 병합, 대소문자 무시 중복 제거
    const promptTokens = image.prompt
      ? image.prompt.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : [];

    const seen = new Set<string>();
    const result: string[] = [];

    // taglist 먼저 추가 (auto_tags 우선)
    for (const token of taglistTokens) {
      const key = token.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(token);
      }
    }

    // prompt 태그 추가 (중복 제거)
    for (const token of promptTokens) {
      const key = token.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(token);
      }
    }

    return result.join(', ');
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
  static async getFileCountByType(groupId: number, groupType: GroupType): Promise<{
    thumbnail: number;
    original: number;
    video: number;
  }> {
    const images = await this.getAllImagesWithFiles(groupId, groupType);

    let thumbnailCount = 0;
    let originalCount = 0;
    let videoCount = 0;

    for (const image of images) {
      // 썸네일 개수
      if (image.thumbnail_path) {
        const thumbPath = path.join(runtimePaths.tempDir, image.thumbnail_path);
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
        const thumbPath = path.join(runtimePaths.tempDir, image.thumbnail_path);
        if (fs.existsSync(thumbPath)) {
          originalCount++;
        }
      }
    }

    return { thumbnail: thumbnailCount, original: originalCount, video: videoCount };
  }
}
