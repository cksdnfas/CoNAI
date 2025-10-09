const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Resolve the base directory where runtime data (uploads, database, logs, temp) should live.
 * - Development: project root so assets stay local
 * - Production: alongside the packaged executable to keep data portable
 * - Override: honour RUNTIME_BASE_PATH when provided (useful for tests or custom paths)
 */
function resolveRuntimeBasePath() {
  const overridePath = process.env.RUNTIME_BASE_PATH;
  if (overridePath && overridePath.trim().length > 0) {
    return path.resolve(overridePath);
  }

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && portableDir.trim().length > 0) {
    return path.resolve(portableDir);
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    return path.resolve(__dirname, '..');
  }

  if (process.platform === 'darwin') {
    // Electron executable lives inside MyApp.app/Contents/MacOS
    // Store data next to the .app bundle so it remains portable
    return path.resolve(process.execPath, '..', '..', '..');
  }

  return path.dirname(process.execPath);
}

/**
 * Ensure runtime directories exist under the resolved base path.
 */
function createRequiredDirectories(basePath = resolveRuntimeBasePath()) {
  const directories = {
    uploads: path.join(basePath, 'uploads'),
    database: path.join(basePath, 'database'),
    logs: path.join(basePath, 'logs'),
    temp: path.join(basePath, 'temp')
  };

  Object.values(directories).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });

  return directories;
}

/**
 * Build environment variables for the backend process with optional overrides.
 */
function getBackendEnv(envOverrides = {}, basePath) {
  const resolvedBasePath = basePath ? path.resolve(basePath) : resolveRuntimeBasePath();
  const directories = createRequiredDirectories(resolvedBasePath);

  const mergedEnv = {
    ...process.env,
    ...envOverrides,
    RUNTIME_BASE_PATH: resolvedBasePath,
    UPLOADS_PATH: directories.uploads,
    DATABASE_PATH: path.join(directories.database, 'images.db'),
    LOGS_PATH: directories.logs,
    TEMP_PATH: directories.temp
  };

  const resolvedPort = mergedEnv.PORT || process.env.PORT || '1566';
  const ensureProtocol = (value) => {
    if (!value || value.trim().length === 0) {
      return null;
    }
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  };

  const explicitBase = ensureProtocol(mergedEnv.PUBLIC_BASE_URL) || ensureProtocol(mergedEnv.BACKEND_ORIGIN);
  const fallbackHost = mergedEnv.BACKEND_HOST || 'localhost';
  const fallbackProtocol = mergedEnv.BACKEND_PROTOCOL || 'http';
  const baseUrl = explicitBase || `${fallbackProtocol}://${fallbackHost}:${resolvedPort}`;

  mergedEnv.BACKEND_ORIGIN = mergedEnv.BACKEND_ORIGIN || baseUrl;
  mergedEnv.PUBLIC_BASE_URL = mergedEnv.PUBLIC_BASE_URL || baseUrl;

  return mergedEnv;
}

module.exports = {
  resolveRuntimeBasePath,
  createRequiredDirectories,
  getBackendEnv
};
