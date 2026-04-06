import fs from 'fs';
import path from 'path';

const overrideBasePath = process.env.RUNTIME_BASE_PATH;

const basePath = (() => {
  // 1. Environment variable override (Highest priority)
  if (overrideBasePath && overrideBasePath.trim().length > 0) {
    // Remove inline comments (anything after #) to prevent malformed paths
    const cleaned = overrideBasePath.trim().split('#')[0].trim();
    if (cleaned.length > 0) {
      const resolved = path.resolve(cleaned);
      console.log(`[Config] Data root overridden by RUNTIME_BASE_PATH: ${resolved}`);
      return resolved;
    }
  }

  // 2. Portable mode executable directory
  // This is set when running from the packaged executable
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.trim().length > 0) {
    const resolved = path.resolve(portableDir, 'user');
    console.log(`[Config] Data root set from PORTABLE_EXECUTABLE_DIR: ${resolved}`);
    return resolved;
  }

  // 3. Development/Standard Node detection
  const currentCwd = process.cwd();
  const cwdBasename = path.basename(currentCwd);

  // If running from inside 'backend' or 'dist' (common in dev/build),
  // assume the true root is one level up.
  if (cwdBasename === 'backend' || cwdBasename === 'dist') {
    const resolved = path.resolve(currentCwd, '..', 'user');
    console.log(`[Config] Data root resolved from subdirectory '${cwdBasename}': ${resolved}`);
    return resolved;
  }

  // 4. Default: Current working directory is the root
  // This is the standard behavior for Docker volumes and correct production runs
  const resolved = path.resolve(currentCwd, 'user');
  console.log(`[Config] Data root defaulting to CWD/user: ${resolved}`);
  return resolved;
})();

// Helper function to resolve individual paths with environment variable support
function resolvePath(envVar: string | undefined, defaultPath: string): string {
  if (envVar && envVar.trim().length > 0) {
    // Remove inline comments (anything after #) to prevent malformed paths
    const cleaned = envVar.trim().split('#')[0].trim();

    if (cleaned.length > 0) {
      const resolved = path.resolve(cleaned);
      console.log(`✅ Using custom path: ${resolved}`);
      return resolved;
    }
  }
  return defaultPath;
}

// Define data directories relative to basePath
// This ensures they are always grouped together in the root unless specifically overridden
const uploadsDir = resolvePath(process.env.RUNTIME_UPLOADS_DIR, path.join(basePath, 'uploads'));
const databaseDir = resolvePath(process.env.RUNTIME_DATABASE_DIR, path.join(basePath, 'database'));
const logsDir = resolvePath(process.env.RUNTIME_LOGS_DIR, path.join(basePath, 'logs'));
const tempDir = resolvePath(process.env.RUNTIME_TEMP_DIR, path.join(basePath, 'temp'));
const saveDir = resolvePath(process.env.RUNTIME_SAVE_DIR, path.join(basePath, 'save'));
const canvasDir = resolvePath(process.env.RUNTIME_CANVAS_DIR, path.join(saveDir, 'canvas'));
const modelsDir = resolvePath(process.env.RUNTIME_MODELS_DIR, path.join(basePath, 'models'));
const customNodesDir = resolvePath(process.env.RUNTIME_CUSTOM_NODES_DIR, path.join(basePath, 'custom_nodes'));
const recycleBinDir = resolvePath(process.env.RUNTIME_RECYCLE_BIN_DIR, path.join(basePath, 'RecycleBin'));

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

const resolvedPort = process.env.PORT || '1666';
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
const tempPublicBase = `${publicBaseUrl}/temp`;
const savePublicBase = `${publicBaseUrl}/save`;
const canvasPublicBase = `${savePublicBase}/canvas`;

export const runtimePaths = {
  basePath,
  uploadsDir,
  databaseDir,
  databaseFile,
  logsDir,
  tempDir,
  saveDir,
  canvasDir,
  modelsDir,
  customNodesDir,
  recycleBinDir
};

export const publicUrls = {
  baseUrl: publicBaseUrl,
  uploadsBaseUrl: uploadsPublicBase,
  tempBaseUrl: tempPublicBase,
  saveBaseUrl: savePublicBase,
  canvasBaseUrl: canvasPublicBase,
};

export function ensureRuntimeDirectories(): void {
  console.log('[Config] Data Root Configuration:');
  console.log(`   - Base Path:   ${basePath}`);
  console.log(`   - Uploads:     ${uploadsDir}`);
  console.log(`   - Database:    ${databaseDir}`);
  console.log(`   - Logs:        ${logsDir}`);
  console.log(`   - Models:      ${modelsDir}`);
  console.log(`   - CustomNodes: ${customNodesDir}`);
  console.log(`   - Temp:        ${tempDir}`);
  console.log(`   - Save:        ${saveDir}`);
  console.log(`   - Canvas:      ${canvasDir}`);

  [uploadsDir, databaseDir, logsDir, tempDir, saveDir, canvasDir, modelsDir, customNodesDir, recycleBinDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${path.basename(dir)}`);
      } catch (error) {
        console.error(`❌ Failed to create directory: ${dir}`, error);
      }
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
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created subdirectory: ${path.relative(basePath, dir)}`);
      } catch (error) {
        console.error(`❌ Failed to create subdirectory: ${dir}`, error);
      }
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

  // 썸네일 경로는 temp 폴더에 저장되므로 /temp URL 사용
  if (normalized.startsWith('thumbnails/')) {
    return `${tempPublicBase}/${normalized}`;
  }

  return `${uploadsPublicBase}/${normalized}`;
}
