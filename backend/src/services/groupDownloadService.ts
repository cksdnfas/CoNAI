import { GroupModel, ImageGroupModel } from '../models/Group';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { resolveUploadsPath, runtimePaths } from '../config/runtimePaths';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'os';
import { ImageWithFileView } from '../types/image';
import { writeZip, type ZipEntry } from '../utils/zipArchive';

const zipLimit = pLimit(2);

export type DownloadType = 'thumbnail' | 'original' | 'video';
export type GroupType = 'custom' | 'auto-folder';
export type CaptionMode = 'auto_tags' | 'merged';

interface DownloadOptions {
  groupId: number;
  downloadType: DownloadType;
  groupType: GroupType; // 그룹 타입 추가
  compositeHashes?: string[]; // 선택된 이미지만 다운로드 (없으면 전체)
  includeChildren?: boolean;
  signal?: AbortSignal;
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
    options.signal?.throwIfAborted();
    if (zipLimit.pendingCount >= 20) throw Object.assign(new Error('Too many group downloads. Try again later.'), { status: 503 });
    return zipLimit(() => this.buildGroupZip(options));
  }

  private static async buildGroupZip(options: DownloadOptions): Promise<DownloadResult> {
    const { groupId, downloadType, groupType, compositeHashes, captionOptions, includeChildren = false, signal } = options;
    signal?.throwIfAborted();

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

    // Keep membership/order in the shared queries, but filter before loading the large metadata rows.
    const hashes = this.getGroupHashes(groupId, groupType, includeChildren, compositeHashes);
    if (hashes.length === 0) throw new Error('No images found in group');
    const zipLabel = captionOptions ? 'lora-dataset' : downloadType;
    // A download's disk path is private to the request, independent of its display filename.
    const zipPath = path.join(tmpdir(), `conai-group-${randomUUID()}.zip`);
    const usedNames = new Map<string, number>();
    let fileCount = 0;
    const service = this;
    async function* entries(): AsyncGenerator<ZipEntry> {
      for await (const image of service.loadImagesByCompositeHashes(hashes, signal)) {
        const resolved = await service.resolveDownloadFile(image, downloadType);
        if (!resolved) continue;
        const baseName = image.original_file_path
          ? path.basename(image.original_file_path, path.extname(image.original_file_path))
          : 'image';
        const name = service.getUniqueFileName(baseName, resolved.extension, usedNames, Boolean(captionOptions));
        yield { name, file: resolved.filePath };
        if (captionOptions) yield { name: name.replace(/\.[^.]+$/, '.txt'), data: Buffer.from(service.generateCaptionContent(image, captionOptions.captionMode), 'utf-8') };
        fileCount++;
      }
      if (fileCount === 0) throw new Error(`No ${downloadType} files found in group`);
    }
    try {
      await writeZip(zipPath, entries(), signal);
      signal?.throwIfAborted();
      return { zipPath, fileName: this.generateZipFileName(groupName, zipLabel), fileCount };
    } catch (error) {
      await this.cleanupTempFile(zipPath);
      throw error;
    }
  }

  /** Keep only member hashes, in the group's existing display order. */
  private static getGroupHashes(groupId: number, groupType: GroupType, includeChildren: boolean = false, selected?: string[]): string[] {
    const compositeHashes = groupType === 'custom'
      ? ImageGroupModel.getCompositeHashesForGroup(groupId, includeChildren)
      : AutoFolderGroupImageModel.getCompositeHashesForGroup(groupId, includeChildren);

    const selection = selected?.length ? new Set(selected) : null;
    return [...new Set(compositeHashes)].filter((hash) => hash && (!selection || selection.has(hash)));
  }

  /**
   * composite_hash 목록을 배치 로드하고, 요청 순서를 최대한 유지하면서 중복을 제거한다.
   */
  private static async *loadImagesByCompositeHashes(compositeHashes: string[], signal?: AbortSignal): AsyncGenerator<ImageWithFileView> {
    const batchSize = 500;

    for (let offset = 0; offset < compositeHashes.length; offset += batchSize) {
      signal?.throwIfAborted();
      const batch = compositeHashes.slice(offset, offset + batchSize);
      const rows = MediaMetadataModel.findByHashesWithFiles(batch) as ImageWithFileView[];
      const imagesByHash = new Map<string, ImageWithFileView>();
      for (const row of rows) {
        if (!imagesByHash.has(row.composite_hash)) {
          imagesByHash.set(row.composite_hash, row);
        }
      }
      for (const hash of batch) {
        signal?.throwIfAborted();
        const image = imagesByHash.get(hash);
        if (image) yield image;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * 다운로드 타입에 맞는 실제 파일 경로를 해석한다.
   */
  private static async resolveDownloadFile(image: ImageWithFileView, downloadType: DownloadType): Promise<ResolvedDownloadFile | null> {
    const thumbnailPath = downloadType === 'video' ? null : await this.resolveExistingThumbnail(image);
    const originalInfo = downloadType === 'thumbnail' ? null : await this.resolveExistingOriginal(image);

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

  private static async resolveExistingThumbnail(image: ImageWithFileView): Promise<string | null> {
    if (!image.thumbnail_path) {
      return null;
    }

    const fullPath = path.join(runtimePaths.tempDir, image.thumbnail_path);
    return await this.fileExists(fullPath) ? fullPath : null;
  }

  private static async fileExists(filePath: string): Promise<boolean> {
    try { return (await fs.promises.stat(filePath)).isFile(); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  }

  private static async resolveExistingOriginal(image: ImageWithFileView): Promise<{
    filePath: string;
    extension: string;
    isVideo: boolean;
    isAnimated: boolean;
  } | null> {
    if (!image.original_file_path) {
      return null;
    }

    const filePath = resolveUploadsPath(image.original_file_path);
    if (!await this.fileExists(filePath)) {
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
    usedNames: Map<string, number>,
    withCaption: boolean
  ): string {
    const counterKey = `${baseName}${withCaption ? '.txt' : extension}`.toLowerCase();
    for (let count = usedNames.get(counterKey) ?? 0; ; count++) {
      const stem = count === 0 ? baseName : `${baseName}_${String(count).padStart(3, '0')}`;
      const name = `${stem}${extension}`;
      const caption = `${stem}.txt`;
      // Also reserve the caption stem: a.png and a.jpg must not share a.txt.
      if (usedNames.has(name.toLowerCase()) || (withCaption && usedNames.has(caption.toLowerCase()))) continue;
      usedNames.set(name.toLowerCase(), 1);
      if (withCaption) usedNames.set(caption.toLowerCase(), 1);
      usedNames.set(counterKey, count + 1);
      return name;
    }
  }

  /**
   * ZIP 파일명 생성
   */
  private static generateZipFileName(groupName: string, typeLabel: string): string {
    // 파일명에 사용할 수 없는 문자 제거
    const sanitizedName = groupName.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_');

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
      await fs.promises.rm(zipPath, { force: true });
    } catch (error) {
      console.warn(`Failed to cleanup temp zip file: ${zipPath}`, error);
    }
  }

  /**
   * 그룹의 파일 타입별 개수 조회
   */
  static async getFileCountByType(groupId: number, groupType: GroupType, includeChildren: boolean = false, signal?: AbortSignal): Promise<{
    thumbnail: number;
    original: number;
    video: number;
  }> {
    const hashes = this.getGroupHashes(groupId, groupType, includeChildren);

    let thumbnailCount = 0;
    let originalCount = 0;
    let videoCount = 0;

    for await (const image of this.loadImagesByCompositeHashes(hashes, signal)) {
      const thumbnail = await this.resolveExistingThumbnail(image);
      const original = await this.resolveExistingOriginal(image);
      if (thumbnail) thumbnailCount++;
      if ((original && !original.isVideo) || thumbnail) originalCount++;
      if (original && (original.isVideo || original.isAnimated)) videoCount++;
    }

    return { thumbnail: thumbnailCount, original: originalCount, video: videoCount };
  }
}
