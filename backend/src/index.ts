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

const normalizedNodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
const isDevelopmentEnvironment = normalizedNodeEnv === 'development';
const isProductionEnvironment = !isDevelopmentEnvironment;

// Configure NODE_PATH for native modules in SEA (Single Executable Application)
// This must be done before any imports that depend on native modules
if (isProductionEnvironment || isPackagedRuntime()) {
  const nativeModulesPath = path.join(__dirname, '..', 'node_modules');
  if (require('fs').existsSync(nativeModulesPath)) {
    process.env.NODE_PATH = nativeModulesPath;
    require('module').Module._initPaths();
  }
}

import https from 'https';
import express, { type Request, type Response as ExpressResponse } from 'express';
import sharp from 'sharp';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
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
import {
  resolveRuntimeSideEffectRole,
  shouldSkipHttpServerForRuntimeRole,
  wasSplitRuntimeRoleDemoted,
} from './startup/runtimeRole';
import { logger } from './utils/logger';

// Crash safety: the scheduler layer fires floating promises, and a single rejection
// must not take down the whole process (Node >= 15 exits by default).
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception, exiting:', error);
  logger.close(() => process.exit(1));
  // Fallback in case the log stream never flushes
  setTimeout(() => process.exit(1), 2000).unref();
});

// Keep libvips' worker pool modest so background image processing does not starve API requests.
sharp.concurrency(2);

const app = express();
const PORT = process.env.PORT || PORTS.BACKEND_DEFAULT;
const isDevelopment = isDevelopmentEnvironment;
const isSafeSmokeMode = process.env.SAFE_SMOKE_MODE === 'true';
const runtimeRole = resolveRuntimeSideEffectRole();
const splitRuntimeRoleDemoted = wasSplitRuntimeRoleDemoted();
const shouldStartHttpServer = !shouldSkipHttpServerForRuntimeRole(runtimeRole);
// split 런타임은 프로세스 간 상태를 공유하지 못한다. temp/canvas 정리는 워커 역할 프로세스만 담당한다.
const shouldOwnTempFileLifecycle = runtimeRole !== 'api';
// 종료 시 진행 중인 요청을 기다려 주는 상한. 이 시간이 지나면 남은 소켓을 끊고 정리 단계로 넘어간다.
const SHUTDOWN_DRAIN_TIMEOUT_MS = 3000;

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

const skipAdminRateLimit = (req: Request): boolean => req.session?.accountType === 'admin';

// SSE 스트림은 연결 1건이 요청 1건으로 카운트된다. 재접속 백오프가 겹치면 일반 API 예산을
// 갉아먹으므로 스트림 경로만 레이트 리밋에서 제외한다.
const isRuntimeEventStreamRequest = (req: Request): boolean => req.originalUrl.startsWith('/api/events/');

const skipApiRateLimit = (req: Request): boolean => skipAdminRateLimit(req) || isRuntimeEventStreamRequest(req);

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
  skip: skipApiRateLimit,
});

// Stricter rate limiting for upload endpoints
const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 50, // 최대 50 업로드 요청
  message: 'Too many upload requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAdminRateLimit,
});

// Lenient rate limiting for read-only endpoints (metadata, groups, etc.)
const readOnlyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 2000, // 최대 2000 요청 (very lenient for UI browsing)
  message: 'Too many read requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAdminRateLimit,
});

// Middleware
const isSecureContext = (process.env.BACKEND_PROTOCOL || '').toLowerCase() === 'https';

app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({

  crossOriginResourcePolicy: { policy: 'cross-origin' },

  crossOriginEmbedderPolicy: false,

  crossOriginOpenerPolicy: isSecureContext ? { policy: 'same-origin' } : false,

  originAgentCluster: isSecureContext,

  hsts: isSecureContext ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true } : false,

  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': [
        "'self'",
        (_req, res) => `'nonce-${(res as ExpressResponse).locals.cspNonce as string}'`,
      ],
      'upgrade-insecure-requests': null, // HTTP 접속 허용
      'connect-src': ["'self'", 'http://localhost:*', 'ws:', 'wss:'], // API 연결 허용
      'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'], // 외부 네트워크 이미지 + 로컬 blob 미리보기 허용
      'media-src': ["'self'", 'blob:', 'http:', 'https:'], // 비디오/오디오 미디어 + 로컬 blob 미리보기 허용
    },
  },

}));

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
  filter: (req, res) => {
    // SSE responses must never be buffered by compression
    const contentType = String(res.getHeader('Content-Type') ?? '');
    if (contentType.includes('event-stream')) {
      return false;
    }
    return compression.filter(req, res);
  },
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
    console.log(`🧩 Runtime role: ${runtimeRole}${shouldStartHttpServer ? '' : ' (HTTP disabled)'}`);
    if (splitRuntimeRoleDemoted) {
      console.warn('⚠️  Split runtime role demoted to "all": set CONAI_ALLOW_SPLIT_RUNTIME=true to force the unsupported split runtime');
    }
    const shouldRunWorkerStartupTasks = !isSafeSmokeMode && runtimeRole !== 'api';

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

    if (shouldRunWorkerStartupTasks) {
      await WatchedFolderService.reconcileDefaultUploadFolder();
    } else {
      console.log(`${isSafeSmokeMode ? '🧪 SAFE_SMOKE_MODE' : '🧩 CONAI_RUNTIME_ROLE=api'} enabled, runtime watchers and jobs stay disabled`);
    }

    // 3-1. 첫 실행 안내
    if (isNewDatabase) {
      console.log('✅ 새 데이터베이스 생성 완료');
      console.log('💡 자동 스캔 스케줄러가 곧 첫 스캔을 시작합니다');
    }

    // 4. Initialize session middleware (User Settings DB + Session configuration)
    await initializeSessionMiddleware();

    // Apply API throttling after sessions are available so admins can bypass UI browsing limits.
    // Scoped to /api so static assets, image bytes, and the SPA shell are never rate limited.
    app.use('/api', apiLimiter);

    // 4-1. Sync file-based custom nodes into the module registry.
    const customNodeSyncSkipped = !shouldRunWorkerStartupTasks;
    const customNodeSyncResult = customNodeSyncSkipped
      ? { nodes: [], errors: [] }
      : await (async () => {
          const { CustomNodeRegistryService } = await import('./services/customNodeRegistryService');
          return CustomNodeRegistryService.syncCustomNodesFromFileSystem();
        })();
    if (customNodeSyncSkipped) {
      console.log('🧩 Custom node filesystem sync skipped in API/smoke runtime');
    }

    // 4-2. Register all routes (after session middleware is configured)
    const routeRegistration = registerAppRoutes(app, {
      uploadsDir,
      tempDir,
      saveDir,
      readOnlyLimiter,
      uploadLimiter,
    });

    // 4-3. Runtime event broadcaster (SSE fan-out for queue/history/schedule/execution state)
    // 인메모리 버스만 구독하므로 구독자가 없으면 타이머조차 뜨지 않는다.
    const { RuntimeEventBroadcaster } = await import('./services/runtime-events/runtimeEventBroadcaster');
    if (shouldStartHttpServer) {
      RuntimeEventBroadcaster.start();
    }

    // 5. Bind API generation history to the unified user DB
    initializeApiGenerationDb(); // Synchronous call (better-sqlite3)

    // 5-1. Generation History Cleanup (startup)
    if (shouldRunWorkerStartupTasks) {
      try {
        const { CleanupService } = await import('./services/cleanupService');
        await CleanupService.runStartupCleanup();
      } catch (error) {
        console.warn('⚠️  Failed to run startup cleanup:', error instanceof Error ? error.message : error);
      }
    } else {
      console.log('🧩 Worker startup cleanup skipped in API/smoke runtime');
    }

    // 5-2. Job Tracker 초기화 (generation progress tracking)
    const { JobTracker } = await import('./services/jobTracker');
    JobTracker.initialize();

    // 6. 쿼리 캐시 서비스 초기화
    QueryCacheService.initialize();

    // 6-1. 임시 이미지 서비스 초기화
    // temp/canvas 를 소유하지 않는 API 역할 프로세스가 startup cleanup 을 돌리면
    // 먼저 떠 있던 프로세스의 편집 중 파일까지 지워진다. 단일 프로세스에서는 항상 실행된다.
    if (shouldOwnTempFileLifecycle) {
      const { TempImageService } = await import('./services/tempImageService');
      await TempImageService.initialize();
    } else {
      console.log('🧩 Temp image startup cleanup skipped in API runtime');
    }

    // 6-2. ComfyUI model preview negative cache cleanup
    if (shouldRunWorkerStartupTasks) {
      try {
        const { cleanupComfyModelThumbnailStartupCache } = await import('./services/comfyModelThumbnailService');
        const thumbnailCleanupReport = await cleanupComfyModelThumbnailStartupCache();
        if (thumbnailCleanupReport.missingDeleted > 0 || thumbnailCleanupReport.sourceDeleted > 0 || thumbnailCleanupReport.errors > 0) {
          console.log(
            `🧹 ComfyUI model preview startup cleanup: ${thumbnailCleanupReport.missingDeleted} missing markers, ${thumbnailCleanupReport.sourceDeleted} source files, ${thumbnailCleanupReport.errors} errors`,
          );
        }
      } catch (error) {
        console.warn('⚠️  Failed to cleanup ComfyUI model preview cache:', error instanceof Error ? error.message : error);
      }
    } else {
      console.log('🧩 ComfyUI model preview startup cleanup skipped in API/smoke runtime');
    }

    // 7. API 이미지 저장 디렉토리 생성
    await APIImageProcessor.ensureDirectories();

    // 7-11. Runtime side-effect services
    await startRuntimeSideEffectServices(isSafeSmokeMode, runtimeRole);

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
      const customNodeSummary = customNodeSyncSkipped
        ? '🧩 Custom node sync: skipped in API/smoke runtime'
        : `🧩 Custom nodes: ${customNodeSyncResult.nodes.length} loaded, ${customNodeSyncResult.errors.length} errors`;

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

    const runtimeBannerLines = [`🧩 Runtime role: ${runtimeRole}`];

    const printWorkerRuntimeBanner = () => {
      console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║  🧩 CoNAI worker runtime active                                      ║
╠────────────────────────────────────────────────────────────────────────╣
║  HTTP server disabled. Queue, schedule, watcher, and cleanup jobs run. ║
║  Data Root: ${runtimePaths.basePath.padEnd(57).slice(0, 57)}║
╚════════════════════════════════════════════════════════════════════════╝

💡 Tips:
   - Run an API process separately with CONAI_RUNTIME_ROLE=api
   - Set CONAI_WORKER_HTTP=true only for debugging a worker HTTP endpoint
   - Press Ctrl+C to stop the worker
`);
    };

    const startHttpServer = (extraLines: string[] = runtimeBannerLines): import('http').Server => {
      const httpServer = app.listen(Number(PORT), bindHost, async () => {
        await printBanner('http', extraLines);
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

    let server: import('http').Server | import('https').Server | null = null;

    if (!shouldStartHttpServer) {
      printWorkerRuntimeBanner();
    } else if (isSecureContext) {
      const httpsOptions = await prepareHttpsOptions();

      if (httpsOptions) {
        const extraLines: string[] = [...runtimeBannerLines];
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

    if (server) {
      server.setTimeout?.(60000);
      (server as any).keepAliveTimeout = 65000;
      (server as any).headersTimeout = 66000;
    }

    // Graceful shutdown
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        console.log(`Received ${signal}, but shutdown is already in progress...`);
        return;
      }
      isShuttingDown = true;
      console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

      // Force exit after 10 seconds
      const forceExitTimer = setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
      forceExitTimer.unref();

      // 열린 SSE 스트림은 idle 소켓이 아니라서 서버 close 가 영원히 resolve 되지 않는다.
      // 반드시 서버를 닫기 전에 모든 스트림을 먼저 닫아야 드레인이 제때 끝난다.
      try {
        const closedStreamCount = RuntimeEventBroadcaster.shutdown();
        if (closedStreamCount > 0) {
          console.log(`✅ Runtime event streams closed (${closedStreamCount})`);
        }
      } catch (error) {
        console.warn('⚠️  Error closing runtime event streams:', error);
      }

      // Stop accepting connections and drain in-flight requests first,
      // so nothing is still being served when services and databases go away.
      const activeServer = server;
      if (activeServer) {
        // 스트리밍/장시간 요청 하나가 드레인을 무한정 붙잡으면 강제 종료 타이머(10초)가 먼저 터져
        // DB조차 닫지 못한 채 종료된다. 드레인을 제한하고 남은 소켓은 직접 끊는다.
        await Promise.race([
          new Promise<void>((resolve) => {
            activeServer.close(() => resolve());
            activeServer.closeIdleConnections?.();
          }),
          new Promise<void>((resolve) => {
            setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS).unref();
          }),
        ]);
        activeServer.closeAllConnections?.();
        console.log('✅ Server closed');
      } else {
        console.log('✅ Server was not running or already closed');
      }

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

        // Stop generation history cleanup scheduler
        try {
          const { CleanupService } = await import('./services/cleanupService');
          CleanupService.stopPeriodicCleanup();
          console.log('✅ Generation history cleanup scheduler stopped');
        } catch (error) {
          console.warn('⚠️  Error stopping generation history cleanup scheduler:', error);
        }
      }

      // Cleanup all temp files on shutdown
      // API 역할 프로세스는 공유 temp/canvas 디렉터리의 소유자가 아니므로 정리하지 않는다.
      if (shouldOwnTempFileLifecycle) {
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

      // Close database connections last so drained requests never hit closed handles
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

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();



