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
import express from 'express';
import { runtimePaths, ensureRuntimeDirectories } from './config/runtimePaths';
import { configureSharpRuntime } from './config/sharpRuntime';
import { prepareHttpsOptions } from './utils/httpsOptions';
import { getNetworkInfo, formatNetworkInfo } from './utils/networkInfo';
import { StartupCheck } from './utils/startupCheck';

import { initializeDatabase } from './database/init';
import { initializeApiGenerationDb } from './database/apiGenerationDb';
import { APIImageProcessor } from './services/APIImageProcessor';
import { PORTS } from '@conai/shared';
import { QueryCacheService } from './services/QueryCacheService';
import { WatchedFolderService } from './services/watchedFolderService';
import { configureAppMiddleware } from './startup/configureAppMiddleware';
import {
  createGracefulShutdownCoordinator,
  registerGracefulShutdownSignalHandlers,
} from './startup/gracefulShutdown';
import { assembleSessionApiRoutes, initializeSessionMiddleware } from './startup/initializeSessionMiddleware';
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

configureSharpRuntime();

const app = express();
const PORT = process.env.PORT || PORTS.BACKEND_DEFAULT;
const isSafeSmokeMode = process.env.SAFE_SMOKE_MODE === 'true';
const runtimeRole = resolveRuntimeSideEffectRole();
const splitRuntimeRoleDemoted = wasSplitRuntimeRoleDemoted();
const shouldStartHttpServer = !shouldSkipHttpServerForRuntimeRole(runtimeRole);
// split 런타임은 프로세스 간 상태를 공유하지 못한다. temp/canvas 정리는 워커 역할 프로세스만 담당한다.
const shouldOwnTempFileLifecycle = runtimeRole !== 'api';
const {
  isSecureContext,
  apiLimiter,
  uploadLimiter,
  readOnlyLimiter,
} = configureAppMiddleware(app);

const uploadsDir = runtimePaths.uploadsDir;
const tempDir = runtimePaths.tempDir;
const saveDir = runtimePaths.saveDir;


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

    // 4. Initialize sessions, install API throttling, sync custom nodes, then register routes.
    const customNodeSyncSkipped = !shouldRunWorkerStartupTasks;
    const {
      beforeRoutesResult: customNodeSyncResult,
      routeRegistration,
    } = await assembleSessionApiRoutes({
      app,
      apiLimiter,
      initializeSession: () => initializeSessionMiddleware(app, {
        isSecureContext,
        isDevelopment: isDevelopmentEnvironment,
      }),
      beforeRoutes: async () => {
        const result = customNodeSyncSkipped
          ? { nodes: [], errors: [] }
          : await (async () => {
              const { CustomNodeRegistryService } = await import('./services/customNodeRegistryService');
              return CustomNodeRegistryService.syncCustomNodesFromFileSystem();
            })();
        if (customNodeSyncSkipped) {
          console.log('🧩 Custom node filesystem sync skipped in API/smoke runtime');
        }
        return result;
      },
      registerRoutes: () => registerAppRoutes(app, {
        uploadsDir,
        tempDir,
        saveDir,
        readOnlyLimiter,
        uploadLimiter,
      }),
    });

    // 4-3. Runtime event broadcaster (SSE fan-out for queue/history/schedule/execution state)
    // 인메모리 버스만 구독하므로 구독자가 없으면 타이머조차 뜨지 않는다.
    const { RuntimeEventBroadcaster } = await import('./services/runtime-events/runtimeEventBroadcaster');
    if (shouldStartHttpServer) {
      RuntimeEventBroadcaster.start();
    }

    // 4-4. Runtime job runner (long-running operations: 202 + jobId + progress + cancel)
    // 역할과 무관하게 1회 실행한다. 복구가 단일 트랜잭션이라 두 프로세스가 동시에 돌아도 안전하다.
    const { bootstrapRuntimeJobs } = await import('./services/runtimeJobs');
    bootstrapRuntimeJobs();

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

    const shutdown = createGracefulShutdownCoordinator({
      server,
      isSafeSmokeMode,
      shouldOwnTempFileLifecycle,
    });
    registerGracefulShutdownSignalHandlers(shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();



