import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
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

interface ResolvedDownloadFile {
  filePath: string;
  extension: string;
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
      const selectedHashes = new Set(compositeHashes);
      images = allImages.filter((img) => selectedHashes.has(img.composite_hash));
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
    const compositeHashes = groupType === 'custom'
      ? ImageGroupModel.getCompositeHashesForGroup(groupId)
      : AutoFolderGroupImageModel.getCompositeHashesForGroup(groupId);

    return this.loadImagesByCompositeHashes(compositeHashes);
  }

  /**
   * composite_hash 목록을 배치 로드하고, 요청 순서를 최대한 유지하면서 중복을 제거한다.
   */
  private static loadImagesByCompositeHashes(compositeHashes: string[]): ImageWithFileView[] {
    if (compositeHashes.length === 0) {
      return [];
    }

    const uniqueHashes: string[] = [];
    const seen = new Set<string>();

    for (const hash of compositeHashes) {
      if (!hash || seen.has(hash)) {
        continue;
      }
      seen.add(hash);
      uniqueHashes.push(hash);
    }

    const imagesByHash = new Map<string, ImageWithFileView>();
    const batchSize = 500;

    for (let offset = 0; offset < uniqueHashes.length; offset += batchSize) {
      const batch = uniqueHashes.slice(offset, offset + batchSize);
      const rows = MediaMetadataModel.findByHashesWithFiles(batch) as ImageWithFileView[];

      for (const row of rows) {
        if (!imagesByHash.has(row.composite_hash)) {
          imagesByHash.set(row.composite_hash, row);
        }
      }
    }

    return uniqueHashes
      .map((hash) => imagesByHash.get(hash))
      .filter((image): image is ImageWithFileView => !!image);
  }

  /**
   * 다운로드 타입에 따라 ZIP에 포함할 파일 목록 준비
   */
  private static prepareFilesToZip(
    images: ImageWithFileView[],
    downloadType: DownloadType
  ): Array<{ filePath: string; originalName: string; compositeHash: string; captionContent?: string }> {
    const filesToZip: Array<{ filePath: string; originalName: string; compositeHash: string; captionContent?: string }> = [];
    const usedNames = new Map<string, number>();

    for (const image of images) {
      const resolvedFile = this.resolveDownloadFile(image, downloadType);

      if (resolvedFile) {
        const baseName = image.original_file_path
          ? path.basename(image.original_file_path, path.extname(image.original_file_path))
          : 'image';

        const finalName = this.getUniqueFileName(baseName, resolvedFile.extension, usedNames);

        filesToZip.push({
          filePath: resolvedFile.filePath,
          originalName: finalName,
          compositeHash: image.composite_hash
        });
        continue;
      }

      console.warn(`[GroupDownload] File not found for ${downloadType}:`, {
        composite_hash: image.composite_hash,
        thumbnail_path: image.thumbnail_path,
        original_file_path: image.original_file_path,
      });
    }

    return filesToZip;
  }

  /**
   * 다운로드 타입에 맞는 실제 파일 경로를 해석한다.
   */
  private static resolveDownloadFile(image: ImageWithFileView, downloadType: DownloadType): ResolvedDownloadFile | null {
    const thumbnailPath = this.resolveExistingThumbnail(image);
    const originalInfo = this.resolveExistingOriginal(image);

    if (downloadType === 'thumbnail') {
      return thumbnailPath
        ? { filePath: thumbnailPath, extension: path.extname(thumbnailPath) || '.jpg' }
        : null;
    }

    if (downloadType === 'original') {
      if (originalInfo && !originalInfo.isVideo) {
        return { filePath: originalInfo.filePath, extension: originalInfo.extension || '.jpg' };
      }

      return thumbnailPath
        ? { filePath: thumbnailPath, extension: path.extname(thumbnailPath) || '.jpg' }
        : null;
    }

    if (originalInfo && (originalInfo.isVideo || originalInfo.isAnimated)) {
      return { filePath: originalInfo.filePath, extension: originalInfo.extension };
    }

    return null;
  }

  private static resolveExistingThumbnail(image: ImageWithFileView): string | null {
    if (!image.thumbnail_path) {
      return null;
    }

    const fullPath = path.join(runtimePaths.tempDir, image.thumbnail_path);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  private static resolveExistingOriginal(image: ImageWithFileView): {
    filePath: string;
    extension: string;
    isVideo: boolean;
    isAnimated: boolean;
  } | null {
    if (!image.original_file_path) {
      return null;
    }

    const filePath = resolveUploadsPath(image.original_file_path);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const extension = path.extname(image.original_file_path).toLowerCase() || '.jpg';
    const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(extension);
    const isAnimated = extension === '.gif';

    return {
      filePath,
      extension,
      isVideo,
      isAnimated
    };
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
      if (this.resolveDownloadFile(image, 'thumbnail')) {
        thumbnailCount++;
      }

      if (this.resolveDownloadFile(image, 'original')) {
        originalCount++;
      }

      if (this.resolveDownloadFile(image, 'video')) {
        videoCount++;
      }
    }

    return { thumbnail: thumbnailCount, original: originalCount, video: videoCount };
  }
}
