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
  modelsDir
};

export const publicUrls = {
  baseUrl: publicBaseUrl,
  uploadsBaseUrl: uploadsPublicBase
};

export function ensureRuntimeDirectories(): void {
  [uploadsDir, databaseDir, logsDir, tempDir, modelsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

export function resolveUploadsPath(...segments: string[]): string {
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
  const normalized = normalizeUploadSegment(relativePath);
  return `${uploadsPublicBase}/${normalized}`;
}
