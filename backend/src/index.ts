// Configure NODE_PATH for native modules in SEA (Single Executable Application)
// This must be done before any imports that depend on native modules
if (process.env.NODE_ENV === 'production' || process.execPath.includes('comfyui-image-manager')) {
  const nativeModulesPath = require('path').join(__dirname, '..', 'node_modules');
  if (require('fs').existsSync(nativeModulesPath)) {
    process.env.NODE_PATH = nativeModulesPath;
    require('module').Module._initPaths();
  }
}

import https from 'https';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { runtimePaths, ensureRuntimeDirectories } from './config/runtimePaths';
import { prepareHttpsOptions } from './utils/httpsOptions';
import { getNetworkInfo, formatNetworkInfo } from './utils/networkInfo';

import { imageRoutes } from './routes/images/index';
import promptCollectionRoutes from './routes/promptCollection';
import promptGroupRoutes from './routes/promptGroups';
import negativePromptGroupRoutes from './routes/negativePromptGroups';
import { groupRoutes } from './routes/groups';
import { settingsRoutes } from './routes/settings';
import { workflowRoutes } from './routes/workflows';
import { comfyuiServerRoutes } from './routes/comfyuiServers';
import { customDropdownListRoutes } from './routes/customDropdownLists';
import naiRoutes from './routes/nai';
import generationHistoryRoutes from './routes/generation-history.routes';
import wildcardRoutes from './routes/wildcards';
import { watchedFoldersRoutes } from './routes/watchedFolders';
import { backgroundQueueRoutes } from './routes/backgroundQueue';
import { systemRoutes } from './routes/system.routes';
import imageEditorRoutes from './routes/image-editor.routes';
import { initializeDatabase } from './database/init';
import { initializeUserSettingsDb } from './database/userSettingsDb';
import { initializeApiGenerationDb } from './database/apiGenerationDb';
import { errorHandler } from './middleware/errorHandler';
import { imageTaggerService } from './services/imageTaggerService';
import { APIImageProcessor } from './services/APIImageProcessor';
import { PORTS, IMAGE_PROCESSING } from '@comfyui-image-manager/shared';
import { settingsService } from './services/settingsService';
import { AutoScanScheduler } from './services/autoScanScheduler';
import { autoTagScheduler } from './services/autoTagScheduler';
import { QueryCacheService } from './services/QueryCacheService';

const app = express();
const PORT = process.env.PORT || PORTS.BACKEND_DEFAULT;

// Rate limiting (개발 환경에서는 더 관대하게 설정)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 1000, // 최대 1000 요청 (개발용)
  message: 'Too many requests from this IP',
  standardHeaders: true, // rate limit 정보를 `RateLimit-*` 헤더에 포함
  legacyHeaders: false, // X-RateLimit-* 헤더 비활성화
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
      'img-src': ["'self'", 'data:', 'http:', 'https:'], // 외부 네트워크 이미지 로딩 허용
      'media-src': ["'self'", 'http:', 'https:'], // 비디오/오디오 미디어 로딩 허용
    },
  },

}));
app.use(limiter);
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:1577',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

app.use(cors({
  origin: (_origin, callback) => {
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json({ limit: `${IMAGE_PROCESSING.MAX_FILE_SIZE_MB}mb`, strict: false }));
app.use(express.urlencoded({ extended: true, limit: `${IMAGE_PROCESSING.MAX_FILE_SIZE_MB}mb` }));

// .env 파일 자동 생성
const createEnvFileIfNotExists = () => {
  const envPath = path.join(__dirname, '../.env');
  const envExamplePath = path.join(__dirname, '../.env.example');

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('📝 Created .env file from .env.example');
  }
};

const uploadsDir = runtimePaths.uploadsDir;

// 정적 파일 서빙 (썸네일 및 원본 이미지) - CORS 및 캐시 헤더 추가
app.use('/uploads', express.static(uploadsDir, {
  // 외부 네트워크에서도 접근 가능하도록 CORS 헤더 추가
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // 이미지 파일에 대한 캐시 설정
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
  // 성능 최적화
  etag: true,
  lastModified: true,
  maxAge: '1y'
}));

// Routes
app.use('/api/images', imageRoutes);
app.use('/api/prompt-collection', promptCollectionRoutes);
app.use('/api/prompt-groups', promptGroupRoutes);
app.use('/api/negative-prompt-groups', negativePromptGroupRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/comfyui-servers', comfyuiServerRoutes);
app.use('/api/custom-dropdown-lists', customDropdownListRoutes);
app.use('/api/nai', naiRoutes);
app.use('/api/generation-history', generationHistoryRoutes);
app.use('/api/wildcards', wildcardRoutes);
app.use('/api/folders', watchedFoldersRoutes);
app.use('/api/background-queue', backgroundQueueRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/image-editor', imageEditorRoutes);

// Frontend static file serving
const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, 'frontend');  // SEA integrated build uses dist/frontend

if (fs.existsSync(frontendDistPath)) {
  console.log(`🎨 Serving frontend from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next();
      return;
    }

    const indexPath = path.join(frontendDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend not found. Please build the frontend first.' });
    }
  });
} else {
  console.warn('⚠️  Frontend dist not found. API-only mode.');
  console.warn(`   Expected location: ${frontendDistPath}`);
  console.warn('   Run "npm run build:integrated" to build with frontend.\n');
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 데이터베이스 초기화 및 서버 시작
async function startServer() {
  try {
    console.log('🚀 ComfyUI Image Manager Backend 시작 중...\n');

    // 1. 필요한 폴더들 자동 생성 (uploads, database, logs, temp, models, RecycleBin)
    console.log('📁 필요한 폴더들을 확인하고 생성 중...');
    ensureRuntimeDirectories();

    // 2. .env 파일 자동 생성
    console.log('⚙️  환경 설정을 확인하고 생성 중...');
    createEnvFileIfNotExists();

    // 3. 데이터베이스 자동 초기화
    console.log('🗄️  데이터베이스를 초기화하는 중...');
    const isNewDatabase = !fs.existsSync(runtimePaths.databaseFile);
    await initializeDatabase();
    console.log('✅ Database initialized successfully');

    // 3-1. 첫 실행 안내
    if (isNewDatabase) {
      console.log('✅ 새 데이터베이스 생성 완료');
      console.log('💡 자동 스캔 스케줄러가 곧 첫 스캔을 시작합니다');
    }

    // 4. User Settings DB 초기화
    console.log('🗄️  User Settings DB 초기화 중...');
    initializeUserSettingsDb(); // Synchronous call (better-sqlite3)
    console.log('✅ User Settings DB initialized successfully');

    // 5. API Generation History DB 초기화
    console.log('🗄️  API Generation History DB 초기화 중...');
    initializeApiGenerationDb(); // Synchronous call (better-sqlite3)
    console.log('✅ API Generation History DB initialized successfully');

    // 6. 쿼리 캐시 서비스 초기화
    console.log('💾 Query cache service 초기화 중...');
    QueryCacheService.initialize();

    // 6-1. 임시 이미지 서비스 초기화
    console.log('🖼️  Temp image service 초기화 중...');
    const { TempImageService } = await import('./services/tempImageService');
    await TempImageService.initialize();
    console.log('✅ Temp image service initialized successfully');

    // 7. API 이미지 저장 디렉토리 생성
    console.log('📁 API 이미지 디렉토리 생성 중...');
    await APIImageProcessor.ensureDirectories();

    // 7. Tagger daemon 자동 시작 (설정이 활성화된 경우)
    const settings = settingsService.loadSettings();
    if (settings.tagger.enabled) {
      console.log('🤖 Starting tagger daemon...');
      try {
        await imageTaggerService.startDaemon();
        console.log('✅ Tagger daemon started successfully');
      } catch (error) {
        console.warn('⚠️  Failed to start tagger daemon:', error instanceof Error ? error.message : error);
        console.warn('   Tagger will be started on first use');
      }
    } else {
      console.log('⏭️  Tagger is disabled - skipping daemon startup');
    }

    // 8. 파일 워처 서비스 시작 (실시간 파일 모니터링)
    if (process.env.ENABLE_FILE_WATCHING !== 'false') {
      try {
        console.log('👀 Starting file watcher service...');
        const { FileWatcherService } = await import('./services/fileWatcherService');
        await FileWatcherService.initialize();
        console.log('✅ File watcher service started successfully');
      } catch (error) {
        console.warn('⚠️  Failed to start file watcher service:', error instanceof Error ? error.message : error);
        console.warn('   Falling back to scheduled scans only');
      }
    } else {
      console.log('⏭️  File watching is disabled - using scheduled scans only');
    }

    // 9. 자동 스캔 스케줄러 시작
    console.log('🤖 Starting auto-scan scheduler...');
    AutoScanScheduler.start();
    console.log('✅ Auto-scan scheduler started successfully');

    // 10. 자동 태깅 스케줄러 시작
    console.log('🤖 Starting auto-tag scheduler...');
    autoTagScheduler.start();
    console.log('✅ Auto-tag scheduler started successfully');

    // 11. 임시 이미지 정리 스케줄러 시작
    console.log('🧹 Starting temp image cleanup scheduler...');
    const { TempImageCleanupScheduler } = await import('./cron/tempImageCleanup');
    TempImageCleanupScheduler.start();
    console.log('✅ Temp image cleanup scheduler started successfully');

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

      console.log(`
${divider}`);
      console.log(formatLine('🎉 ComfyUI Image Manager - Server Running!'));
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

      if (extraLines.length > 0) {
        console.log(separator);
        extraLines.forEach((line) => console.log(formatLine(line)));
      }

      console.log(`${footer}

💡 Tips:
   - Access from this computer: ${networkInfo.localUrl}
   - Access from local network: Use any of the network URLs above
   - For external access: Configure port forwarding on your router
   - Press Ctrl+C to stop the server
`);
    };

    const startHttpServer = (): import('http').Server =>
      app.listen(Number(PORT), bindHost, async () => {
        await printBanner('http');
      });

    let server: import('http').Server | import('https').Server;

    if (isSecureContext) {
      const httpsOptions = prepareHttpsOptions();

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
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');

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

      // Cleanup all temp files on shutdown
      try {
        const { TempImageService } = await import('./services/tempImageService');
        await TempImageService.cleanupAll();
        console.log('✅ All temp files cleaned up');
      } catch (error) {
        console.warn('⚠️  Error cleaning up temp files:', error);
      }

      // Stop tagger daemon
      try {
        await imageTaggerService.stopDaemon();
        console.log('✅ Tagger daemon stopped');
      } catch (error) {
        console.warn('⚠️  Error stopping tagger daemon:', error);
      }

      // Close server
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();







