import path from 'path';
import { normalizeFilename } from './pathResolver';

const MAX_ORIGINAL_BASENAME_LENGTH = 120;

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function getDateParts(now: Date = new Date()): DateParts {
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
    hour: String(now.getHours()).padStart(2, '0'),
    minute: String(now.getMinutes()).padStart(2, '0'),
    second: String(now.getSeconds()).padStart(2, '0'),
  };
}

function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

export function getDateFolder(now: Date = new Date()): string {
  const { year, month, day } = getDateParts(now);
  return `${year}-${month}-${day}`;
}

export function normalizeRelativePath(targetPath: string, basePath: string): string {
  return path.relative(basePath, targetPath).replace(/\\/g, '/');
}

export function generateUniqueOriginalFilename(originalName: string, forcedExtension?: string): string {
  const { year, month, day, hour, minute, second } = getDateParts();
  const random = generateRandomSuffix();

  // 원본명에서 파일명만 사용 (경로 문자열 유입 방지)
  const originalBaseName = path.basename(originalName);

  // 유니코드 정규화 및 안전한 파일명 처리
  const safeOriginalName = normalizeFilename(originalBaseName);

  // 확장자 분리
  const originalExtension = path.extname(safeOriginalName);
  const normalizedForcedExtension = forcedExtension
    ? (forcedExtension.startsWith('.') ? forcedExtension : `.${forcedExtension}`)
    : '';
  const ext = normalizedForcedExtension || originalExtension;
  const nameWithoutExt = path.basename(safeOriginalName, originalExtension);

  // 경로 길이 폭증 방지를 위해 파일명 길이 제한
  const truncatedName = nameWithoutExt.length > MAX_ORIGINAL_BASENAME_LENGTH
    ? nameWithoutExt.substring(0, MAX_ORIGINAL_BASENAME_LENGTH)
    : nameWithoutExt;

  // 타임스탬프_랜덤값_원본파일명.확장자 형식
  return `${year}${month}${day}_${hour}${minute}${second}_${random}_${truncatedName}${ext}`;
}

export function generateDatedRandomFilename(extension: string = 'png'): string {
  const { year, month, day, hour, minute, second } = getDateParts();
  const random = generateRandomSuffix();

  return `${year}_${month}_${day}_${hour}${minute}${second}_${random}.${extension}`;
}
