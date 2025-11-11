import fs from 'fs';
import path from 'path';

const overrideBasePath = process.env.RUNTIME_BASE_PATH;

const basePath = (() => {
  if (overrideBasePath && overrideBasePath.trim().length > 0) {
    return path.resolve(overrideBasePath);
  }

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.trim().length > 0) {
    return path.resolve(portableDir);
  }

  if (process.env.NODE_ENV === 'development') {
    // In development the backend runs from the backend workspace directory
    // Move one level up so data lives in the project root for easier inspection
    return path.resolve(process.cwd(), '..');
  }

  // Fallback: keep data next to the current working directory (e.g. packaged resources)
  return path.resolve(process.cwd());
})();

const uploadsDir = path.join(basePath, 'uploads');
const databaseDir = path.join(basePath, 'database');
const logsDir = path.join(basePath, 'logs');
const tempDir = path.join(basePath, 'temp');
const modelsDir = path.join(basePath, 'models');
const recycleBinDir = path.join(basePath, 'RecycleBin');
const databaseFile = path.join(databaseDir, 'images.db');

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function ensureProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `http://${url}`;
}

const resolvedPort = process.env.PORT || '1566';
const publicBaseUrl = (() => {
  const overrides = [process.env.PUBLIC_BASE_URL, process.env.BACKEND_ORIGIN];
  const explicit = overrides.find(value => value && value.trim().length > 0);
  if (explicit) {
    return stripTrailingSlash(ensureProtocol(explicit.trim()));
  }

  const host = process.env.BACKEND_HOST || 'localhost';
  const protocol = process.env.BACKEND_PROTOCOL || 'http';
  return `${protocol}://${host}:${resolvedPort}`;
})();

const uploadsPublicBase = `${publicBaseUrl}/uploads`;

export const runtimePaths = {
  basePath,
  uploadsDir,
  databaseDir,
  databaseFile,
  logsDir,
  tempDir,
  modelsDir,
  recycleBinDir
};

export const publicUrls = {
  baseUrl: publicBaseUrl,
  uploadsBaseUrl: uploadsPublicBase
};

export function ensureRuntimeDirectories(): void {
  [uploadsDir, databaseDir, logsDir, tempDir, modelsDir, recycleBinDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${path.basename(dir)}`);
    }
  });

  // Create upload subdirectories to match default database folders
  const subdirectories = [
    path.join(uploadsDir, 'images'),           // 직접 업로드
    path.join(uploadsDir, 'API', 'images'),    // API 생성 이미지
    path.join(uploadsDir, 'videos')            // 비디오 업로드
  ];

  subdirectories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created subdirectory: ${path.relative(basePath, dir)}`);
    }
  });
}

export function resolveUploadsPath(...segments: string[]): string {
  // If single segment and it's an absolute path that exists, return as-is
  // This handles external folder paths (watched folders)
  if (segments.length === 1 && path.isAbsolute(segments[0])) {
    return segments[0];
  }

  // Otherwise join with uploadsDir for relative paths
  return path.join(uploadsDir, ...segments);
}

function normalizeUploadSegment(relativePath: string): string {
  const withoutPrefix = relativePath
    .replace(/^[/\\]+/, '')
    .replace(/^uploads[/\\]+/i, '');
  return withoutPrefix.replace(/\\/g, '/');
}

export function toUploadsUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) {
    return null;
  }

  // 절대 경로인 경우 (외부 폴더) - API 엔드포인트 사용을 위해 null 반환
  // Windows: C:\, D:\, E:\ 등
  // Linux/Mac: /로 시작
  if (path.isAbsolute(relativePath)) {
    return null;
  }

  const normalized = normalizeUploadSegment(relativePath);
  return `${uploadsPublicBase}/${normalized}`;
}
