// Load environment variables from ROOT .env file
// This must be done before any other imports that depend on process.env
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { resolveEnvExamplePath, resolveEnvPath, isPackagedRuntime } from './utils/envPath';

function ensureEnvFileExists(envPath: string): void {
  const envExamplePath = resolveEnvExamplePath(envPath, __dirname);

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log(`[Config] Created .env from ${path.basename(envExamplePath)} at: ${envPath}`);
  }
}

const rootEnvPath = resolveEnvPath(__dirname);
ensureEnvFileExists(rootEnvPath);
dotenv.config({ path: rootEnvPath, quiet: true });
console.log(`[Config] Loaded environment from: ${rootEnvPath}`);


// Configure NODE_PATH for native modules in SEA (Single Executable Application)
// This must be done before any imports that depend on native modules
if (process.env.NODE_ENV === 'production' || isPackagedRuntime()) {
  const nativeModulesPath = path.join(__dirname, '..', 'node_modules');
  if (require('fs').existsSync(nativeModulesPath)) {
    process.env.NODE_PATH = nativeModulesPath;
    require('module').Module._initPaths();
  }
}

import https from 'https';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import { runtimePaths, ensureRuntimeDirectories } from './config/runtimePaths';
import { resolveSessionSecret } from './utils/sessionSecret';
import { prepareHttpsOptions } from './utils/httpsOptions';
import { getNetworkInfo, formatNetworkInfo } from './utils/networkInfo';
import { StartupCheck } from './utils/startupCheck';

import { initializeDatabase } from './database/init';
import { initializeUserSettingsDb } from './database/userSettingsDb';
import { initializeAuthDb, getAuthDb } from './database/authDb';
import { initializeApiGenerationDb } from './database/apiGenerationDb';
import { imageTaggerService } from './services/imageTaggerService';
import { APIImageProcessor } from './services/APIImageProcessor';
import { PORTS, IMAGE_PROCESSING } from '@conai/shared';
import { AutoScanScheduler } from './services/autoScanScheduler';
import { autoTagScheduler } from './services/autoTagScheduler';
import { QueryCacheService } from './services/QueryCacheService';
import { WatchedFolderService } from './services/watchedFolderService';
import { registerAppRoutes } from './startup/registerAppRoutes';
import { startRuntimeSideEffectServices } from './startup/startRuntimeSideEffectServices';

const app = express();
const PORT = process.env.PORT || PORTS.BACKEND_DEFAULT;
const isDevelopment = process.env.NODE_ENV !== 'production';
const isSafeSmokeMode = process.env.SAFE_SMOKE_MODE === 'true';

/** Resolve the Express trust-proxy setting for direct and proxied deployments. */
function resolveTrustProxySetting() {
  const configuredValue = process.env.TRUST_PROXY?.trim();

  if (!configuredValue) {
    const hasExternalOriginHint = Boolean(process.env.PUBLIC_BASE_URL || process.env.BACKEND_HOST || process.env.PUBLIC_HOST);
    const usesHttpsOrigin = (process.env.BACKEND_PROTOCOL || '').toLowerCase() === 'https';
    return hasExternalOriginHint || usesHttpsOrigin ? 1 : false;
  }

  if (configuredValue === 'true') {
    return true;
  }

  if (configuredValue === 'false') {
    return false;
  }

  const numericValue = Number(configuredValue);
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  return configuredValue;
}

const trustProxySetting = resolveTrustProxySetting();
app.set('trust proxy', trustProxySetting);
console.log(`[Config] Express trust proxy: ${String(trustProxySetting)}`);

// Rate limiting for login endpoint (prevent brute-force attacks)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 최대 5회 시도
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // 성공한 요청은 카운트 제외
});

// General API rate limiting - Increased for UI intensive operations
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 1000, // 최대 1000 요청 (from 100, increased for heavy UI operations)
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for upload endpoints
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 50, // 최대 50 업로드 요청
  message: 'Too many upload requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
});

// Lenient rate limiting for read-only endpoints (metadata, groups, etc.)
const readOnlyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 2000, // 최대 2000 요청 (very lenient for UI browsing)
  message: 'Too many read requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
const isSecureContext = (process.env.BACKEND_PROTOCOL || '').toLowerCase() === 'https';



app.use(helmet({

  crossOriginResourcePolicy: { policy: 'cross-origin' },

  crossOriginEmbedderPolicy: false,

  crossOriginOpenerPolicy: isSecureContext ? { policy: 'same-origin' } : false,

  originAgentCluster: isSecureContext,

  hsts: isSecureContext ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true } : false,

  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'upgrade-insecure-requests': null, // HTTP 접속 허용
      'connect-src': ["'self'", 'http://localhost:*', 'ws:', 'wss:'], // API 연결 허용
      'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'], // 외부 네트워크 이미지 + 로컬 blob 미리보기 허용
      'media-src': ["'self'", 'blob:', 'http:', 'https:'], // 비디오/오디오 미디어 + 로컬 blob 미리보기 허용
    },
  },

}));
app.use(apiLimiter);

const allowedOrigins = [
  'http://localhost:5555',
  'http://localhost:1677',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

app.use(cors({
  origin: (_origin, callback) => {
    callback(null, true);
  },
  credentials: true
}));
app.use(compression({
  threshold: 1024,
}));
app.use(express.json({ limit: `${IMAGE_PROCESSING.MAX_FILE_SIZE_MB}mb`, strict: false }));
app.use(express.urlencoded({ extended: true, limit: `${IMAGE_PROCESSING.MAX_FILE_SIZE_MB}mb` }));

const uploadsDir = runtimePaths.uploadsDir;
const tempDir = runtimePaths.tempDir;
const saveDir = runtimePaths.saveDir;

// Initialize session middleware early (will be configured in initializeSessionMiddleware)
async function initializeSessionMiddleware() {
  initializeAuthDb(); // Synchronous call (better-sqlite3)
  initializeUserSettingsDb(); // Synchronous call (better-sqlite3)

  const SqliteStore = BetterSqlite3Store(session);
  const sessionSecret = resolveSessionSecret().secret;

  const sessionMiddleware = session({
    store: new SqliteStore({
      client: getAuthDb(), // Changed from getUserSettingsDb() to getAuthDb()
      expired: {
        clear: true,
        intervalMs: 900000 // 15분마다 만료 세션 정리
      }
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
      httpOnly: true,
      // 개발 환경: sameSite='lax'로 동일 사이트 정책 완화, secure=false
      // 프로덕션: sameSite='lax', secure는 HTTPS 여부에 따라
      secure: isSecureContext && !isDevelopment, // 개발에서는 false
      sameSite: 'lax' // 개발/프로덕션 모두 lax (localhost는 동일 사이트로 간주)
    },
    name: 'conai.sid' // Custom session cookie name
  });

  app.use(sessionMiddleware);
}


// 데이터베이스 초기화 및 서버 시작
async function startServer() {
  try {
    console.log('🚀 CoNAI starting...\n');

    // 0. Initialize i18n (language settings)
    const { initI18n } = await import('./i18n');
    initI18n();

    // 1. 필요한 폴더들 자동 생성 (uploads, database, logs, temp, models, RecycleBin)
    ensureRuntimeDirectories();

    // 1-1. 시스템 환경 체크 (권한, 도커 등)
    await StartupCheck.runAllChecks();

    // 2. 데이터베이스 자동 초기화
    const isNewDatabase = !fs.existsSync(runtimePaths.databaseFile);
    await initializeDatabase();

    if (!isSafeSmokeMode) {
      await WatchedFolderService.reconcileDefaultUploadFolder();
    } else {
      console.log('🧪 SAFE_SMOKE_MODE enabled, runtime watchers and jobs stay disabled');
    }

    // 3-1. 첫 실행 안내
    if (isNewDatabase) {
      console.log('✅ 새 데이터베이스 생성 완료');
      console.log('💡 자동 스캔 스케줄러가 곧 첫 스캔을 시작합니다');
    }

    // 4. Initialize session middleware (User Settings DB + Session configuration)
    await initializeSessionMiddleware();

    // 4-1. Sync file-based custom nodes into the module registry.
    const { CustomNodeRegistryService } = await import('./services/customNodeRegistryService');
    const customNodeSyncResult = await CustomNodeRegistryService.syncCustomNodesFromFileSystem();

    // 4-2. Register all routes (after session middleware is configured)
    const routeRegistration = registerAppRoutes(app, {
      uploadsDir,
      tempDir,
      saveDir,
      readOnlyLimiter,
      uploadLimiter,
    });

    // 5. Bind API generation history to the unified user DB
    initializeApiGenerationDb(); // Synchronous call (better-sqlite3)

    // 5-1. Generation History Cleanup (startup)
    try {
      const { CleanupService } = await import('./services/cleanupService');
      await CleanupService.runStartupCleanup();
    } catch (error) {
      console.warn('⚠️  Failed to run startup cleanup:', error instanceof Error ? error.message : error);
    }

    // 5-2. Job Tracker 초기화 (generation progress tracking)
    const { JobTracker } = await import('./services/jobTracker');
    JobTracker.initialize();

    // 6. 쿼리 캐시 서비스 초기화
    QueryCacheService.initialize();

    // 6-1. 임시 이미지 서비스 초기화
    const { TempImageService } = await import('./services/tempImageService');
    await TempImageService.initialize();

    // 7. API 이미지 저장 디렉토리 생성
    await APIImageProcessor.ensureDirectories();

    // 7-11. Runtime side-effect services
    await startRuntimeSideEffectServices(isSafeSmokeMode);

    const extractHost = (value?: string | null): string | undefined => {
      if (!value || value.trim().length === 0) {
        return undefined;
      }

      const trimmed = value.trim();

      try {
        const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`http://${trimmed}`);
        return url.hostname;
      } catch (error) {
        return trimmed.split(':')[0];
      }
    };

    const bindHost = process.env.BIND_ADDRESS || process.env.HOST || '0.0.0.0';
    const displayHost =
      process.env.PUBLIC_HOST ||
      process.env.BACKEND_HOST ||
      extractHost(process.env.PUBLIC_BASE_URL) ||
      extractHost(process.env.BACKEND_ORIGIN) ||
      'localhost';

    const printBanner = async (protocol: 'http' | 'https', extraLines: string[] = []) => {
      const innerWidth = 70;
      const divider = '╔' + '═'.repeat(innerWidth + 2) + '╗';
      const separator = '╠' + '─'.repeat(innerWidth + 2) + '╣';
      const footer = '╚' + '═'.repeat(innerWidth + 2) + '╝';
      const formatLine = (text: string) => {
        const truncated = text.length > innerWidth ? `${text.slice(0, innerWidth - 3)}...` : text;
        return `║  ${truncated.padEnd(innerWidth)}║`;
      };

      // Get network information
      const enableExternalIPDetection = process.env.ENABLE_EXTERNAL_IP === 'true';
      const networkInfo = await getNetworkInfo(protocol, PORT, enableExternalIPDetection);
      const networkLines = formatNetworkInfo(networkInfo);

      const uploadsPathRelative = path.relative(runtimePaths.basePath, uploadsDir) || '.';
      const accessHintLines = routeRegistration.frontendMode === 'integrated'
        ? [`🧭 App: ${networkInfo.localUrl} (integrated build)`]
        : [
            '🧪 Before build: UI http://localhost:1677',
            `🧭 After build: app ${networkInfo.localUrl}`,
          ];
      const customNodeSummary = `🧩 Custom nodes: ${customNodeSyncResult.nodes.length} loaded, ${customNodeSyncResult.errors.length} errors`;

      console.log(`
${divider}`);
      console.log(formatLine('🎉 CoNAI - Server Running!'));
      console.log(separator);
      console.log(formatLine('📡 Access URLs:'));
      console.log(formatLine(''));

      // Display all network URLs
      networkLines.forEach((line) => {
        console.log(formatLine(line));
      });

      console.log(separator);
      console.log(formatLine(`📦 Data Root: ${runtimePaths.basePath}`));
      console.log(formatLine(`📁 Uploads: ${uploadsPathRelative}`));
      accessHintLines.forEach((line) => console.log(formatLine(line)));
      console.log(formatLine(customNodeSummary));
      if (isSafeSmokeMode) {
        console.log(formatLine('🧪 SAFE_SMOKE_MODE: runtime jobs disabled'));
      }

      if (extraLines.length > 0) {
        console.log(separator);
        extraLines.forEach((line) => {
          console.log(formatLine(line));
        });
      }

      const tips = routeRegistration.frontendMode === 'integrated'
        ? [
            `   - Open the app on this computer: ${networkInfo.localUrl}`,
            '   - Local network access uses the backend URLs above',
          ]
        : [
            '   - Before integrated build, open the Vite UI: http://localhost:1677',
            `   - Backend API and post-build app entry: ${networkInfo.localUrl}`,
          ];

      console.log(`${footer}

💡 Tips:
${tips.join('\n')}
   - For external access: Configure port forwarding on your router
   - Press Ctrl+C to stop the server
`);
    };

    const startHttpServer = (): import('http').Server => {
      const httpServer = app.listen(Number(PORT), bindHost, async () => {
        await printBanner('http');
      });

      httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EACCES') {
          console.error(`\n❌ ERROR: Port ${PORT} requires elevated privileges or is blocked.`);
          console.error(`   Please try running the terminal as Administrator or use a different port.`);
          console.error(`   (Port settings: .env file or PORTS in shared/constants)`);
        } else if (error.code === 'EADDRINUSE') {
          console.error(`\n❌ ERROR: Port ${PORT} is already in use.`);
          console.error(`   Please close the application using this port or choose a different one.`);
        } else {
          console.error('\n❌ Server error:', error);
        }
        process.exit(1);
      });
      return httpServer;
    };

    let server: import('http').Server | import('https').Server;

    if (isSecureContext) {
      const httpsOptions = await prepareHttpsOptions();

      if (httpsOptions) {
        const extraLines: string[] = [];
        if (httpsOptions.generatedCertPath) {
          extraLines.push(`🔐 Cert: ${httpsOptions.generatedCertPath}`);
        }
        if (httpsOptions.generatedKeyPath) {
          extraLines.push(`🔑 Key: ${httpsOptions.generatedKeyPath}`);
        }

        const httpsServer = https.createServer(httpsOptions, app);
        httpsServer.listen(Number(PORT), bindHost, async () => {
          await printBanner('https', extraLines);
        });

        httpsServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EACCES') {
            console.error(`\n❌ ERROR: Port ${PORT} requires elevated privileges or is blocked.`);
            console.error(`   Please try running the terminal as Administrator or use a different port.`);
          } else if (error.code === 'EADDRINUSE') {
            console.error(`\n❌ ERROR: Port ${PORT} is already in use.`);
          } else {
            console.error('\n❌ Server error:', error);
          }
          process.exit(1);
        });

        server = httpsServer;
      } else {
        console.warn('⚠️ HTTPS 초기화에 실패했습니다. HTTP로 폴백합니다.');
        server = startHttpServer();
      }
    } else {
      server = startHttpServer();
    }

    server.setTimeout?.(60000);
    (server as any).keepAliveTimeout = 65000;
    (server as any).headersTimeout = 66000;

    // Graceful shutdown
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log(`Received ${signal}, but shutdown is already in progress...`);
        return;
      }
      isShuttingDown = true;
      console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

      if (!isSafeSmokeMode) {
        // Stop file watcher service (first to prevent new events)
        try {
          const { FileWatcherService } = await import('./services/fileWatcherService');
          await FileWatcherService.stopAll();
          console.log('✅ File watcher service stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping file watcher service:', error);
        }

        // Stop custom node watcher service
        try {
          const { CustomNodeWatcherService } = await import('./services/customNodeWatcherService');
          await CustomNodeWatcherService.stopAll();
          console.log('✅ Custom node watcher service stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping custom node watcher service:', error);
        }

        // Stop auto-scan scheduler
        try {
          AutoScanScheduler.stop();
          console.log('✅ Auto-scan scheduler stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping auto-scan scheduler:', error);
        }

        // Stop auto-tag scheduler
        try {
          autoTagScheduler.stop();
          console.log('✅ Auto-tag scheduler stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping auto-tag scheduler:', error);
        }

        // Stop temp image cleanup scheduler
        try {
          const { TempImageCleanupScheduler } = await import('./cron/tempImageCleanup');
          TempImageCleanupScheduler.stop();
          console.log('✅ Temp image cleanup scheduler stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping temp image cleanup scheduler:', error);
        }
      }

      // Cleanup all temp files on shutdown
      try {
        const { TempImageService } = await import('./services/tempImageService');
        const { settingsService } = await import('./services/settingsService');

        // Check user setting for canvas cleanup
        const settings = settingsService.loadSettings();
        const shouldCleanupCanvas = settings.general.autoCleanupCanvasOnShutdown ?? false;

        await TempImageService.cleanupAll(!shouldCleanupCanvas);  // skipCanvas = !shouldCleanup
        console.log('✅ All temp files cleaned up');
      } catch (error) {
        console.warn('⚠️  Error cleaning up temp files:', error);
      }

      if (!isSafeSmokeMode) {
        // Stop tagger daemon
        try {
          await imageTaggerService.stopDaemon();
          console.log('✅ Tagger daemon stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping tagger daemon:', error);
        }
      }

      // Stop job tracker
      try {
        const { JobTracker } = await import('./services/jobTracker');
        JobTracker.shutdown();
      } catch (error) {
        console.warn('⚠️  Error stopping job tracker:', error);
      }

      // Close database connections
      try {
        const { closeDatabase } = await import('./database/init');
        closeDatabase();
        console.log('✅ Main database connection closed');
      } catch (error) {
        console.warn('⚠️  Error closing main database:', error);
      }

      try {
        const { closeUserSettingsDb } = await import('./database/userSettingsDb');
        closeUserSettingsDb();
        console.log('✅ User settings database connection closed');
      } catch (error) {
        console.warn('⚠️  Error closing user settings database:', error);
      }

      try {
        const { closeApiGenerationDb } = await import('./database/apiGenerationDb');
        closeApiGenerationDb();
        console.log('✅ API generation database connection closed');
      } catch (error) {
        console.warn('⚠️  Error closing API generation database:', error);
      }

      // Close server
      if (server) {
        try {
          server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
          });
        } catch (error) {
          console.error('⚠️  Error closing server:', error);
          process.exit(1);
        }
      } else {
        console.log('✅ Server was not running or already closed');
        process.exit(0);
      }

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();



