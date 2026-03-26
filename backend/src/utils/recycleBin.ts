import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { normalizeFilename } from './pathResolver';

/**
 * RecycleBin 유틸리티
 * 삭제된 파일을 RecycleBin 폴더로 이동하여 복구 가능하도록 관리
 */

// RecycleBin 폴더 경로 (runtimePaths를 통해 중앙 관리)
export const RECYCLE_BIN_PATH = runtimePaths.recycleBinDir;

/**
 * RecycleBin용 파일명 생성
 * 형식: {timestamp}_{original_filename}
 * 유니코드 정규화를 적용하여 한글/중국어/일본어 파일명 지원
 *
 * @param originalPath - 원본 파일 경로
 * @returns RecycleBin용 파일명 (유니코드 정규화 적용)
 *
 * @example
 * generateRecycleBinFileName('uploads/2025-01-15/한글_이미지.png')
 * // Returns: '2025-01-15T12-30-45-123Z_한글_이미지.png'
 */
export function generateRecycleBinFileName(originalPath: string): string {
  // ISO 8601 타임스탬프 생성 (콜론과 점을 하이픈으로 변경하여 파일명 호환성 확보)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 원본 파일명 추출 및 유니코드 정규화
  const fileName = path.basename(originalPath);
  const normalizedFileName = normalizeFilename(fileName);

  return `${timestamp}_${normalizedFileName}`;
}

/**
 * 파일을 RecycleBin으로 이동
 *
 * @param filePath - 이동할 파일의 전체 경로
 * @returns RecycleBin에 저장된 파일의 전체 경로
 *
 * @throws 파일이 존재하지 않거나 이동 실패 시 에러
 */
export async function copyToRecycleBin(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const recycleBinFileName = generateRecycleBinFileName(filePath);
  const recycleBinFilePath = path.join(RECYCLE_BIN_PATH, recycleBinFileName);
  await fs.promises.copyFile(filePath, recycleBinFilePath);
  return recycleBinFilePath;
}

export async function moveToRecycleBin(filePath: string): Promise<string> {
  const recycleBinFilePath = await copyToRecycleBin(filePath);

  try {
    await fs.promises.unlink(filePath);
    console.log(`♻️ Moved to RecycleBin: ${path.basename(filePath)} → ${path.basename(recycleBinFilePath)}`);
    return recycleBinFilePath;
  } catch (error) {
    console.error(`❌ Failed to move file to RecycleBin:`, error);

    if (fs.existsSync(recycleBinFilePath)) {
      try {
        await fs.promises.unlink(recycleBinFilePath);
      } catch (cleanupError) {
        console.error(`⚠️ Failed to cleanup RecycleBin file:`, cleanupError);
      }
    }

    throw error;
  }
}

/**
 * 파일을 완전히 삭제
 * RecycleBin을 사용하지 않고 즉시 삭제
 *
 * @param filePath - 삭제할 파일의 전체 경로
 *
 * @throws 파일이 존재하지 않거나 삭제 실패 시 에러
 */
export async function deleteFilePermanently(filePath: string): Promise<void> {
  // 파일 존재 확인
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ File not found (skipping): ${filePath}`);
    return;
  }

  // 파일인지 확인 (디렉토리는 제외)
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    console.warn(`⚠️ Not a file (skipping): ${filePath}`);
    return;
  }

  try {
    await fs.promises.unlink(filePath);
    console.log(`🗑️ Permanently deleted: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Failed to delete file:`, error);
    throw error;
  }
}

/**
 * 파일 삭제 (설정에 따라 RecycleBin 이동 또는 완전 삭제)
 *
 * @param filePath - 삭제할 파일의 전체 경로
 * @param useRecycleBin - RecycleBin 사용 여부
 * @returns RecycleBin 사용 시 RecycleBin 경로, 완전 삭제 시 undefined
 */
export async function deleteFile(
  filePath: string,
  useRecycleBin: boolean
): Promise<string | undefined> {
  if (useRecycleBin) {
    return await moveToRecycleBin(filePath);
  } else {
    await deleteFilePermanently(filePath);
    return undefined;
  }
}

/**
 * RecycleBin 폴더 정보 조회
 *
 * @returns RecycleBin 폴더 정보 (파일 개수, 총 크기)
 */
export async function getRecycleBinInfo(): Promise<{
  fileCount: number;
  totalSize: number;
  files: Array<{
    name: string;
    size: number;
    created: Date;
  }>;
}> {
  if (!fs.existsSync(RECYCLE_BIN_PATH)) {
    return { fileCount: 0, totalSize: 0, files: [] };
  }

  const files = await fs.promises.readdir(RECYCLE_BIN_PATH);
  let totalSize = 0;
  const fileInfos: Array<{ name: string; size: number; created: Date }> = [];

  for (const file of files) {
    const filePath = path.join(RECYCLE_BIN_PATH, file);
    const stats = await fs.promises.stat(filePath);

    if (stats.isFile()) {
      totalSize += stats.size;
      fileInfos.push({
        name: file,
        size: stats.size,
        created: stats.birthtime,
      });
    }
  }

  return {
    fileCount: fileInfos.length,
    totalSize,
    files: fileInfos.sort((a, b) => b.created.getTime() - a.created.getTime()),
  };
}
