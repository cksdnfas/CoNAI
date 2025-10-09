import https from 'https';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { runtimePaths, ensureRuntimeDirectories } from './config/runtimePaths';
import { prepareHttpsOptions } from './utils/httpsOptions';

import { imageRoutes } from './routes/images';
import promptCollectionRoutes from './routes/promptCollection';
import promptGroupRoutes from './routes/promptGroups';
import negativePromptGroupRoutes from './routes/negativePromptGroups';
import { groupRoutes } from './routes/groups';
import { initializeDatabase } from './database/init';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 1566;

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

  hsts: isSecureContext ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true } : false

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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// 정적 파일 서빙 (썸네일 및 원본 이미지)
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/images', imageRoutes);
app.use('/api/prompt-collection', promptCollectionRoutes);
app.use('/api/prompt-groups', promptGroupRoutes);
app.use('/api/negative-prompt-groups', negativePromptGroupRoutes);
app.use('/api/groups', groupRoutes);

const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.join(__dirname, '../frontend/dist');

if (fs.existsSync(frontendDistPath)) {
  console.log(`🎨 Serving frontend from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
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

    // 1. 필요한 폴더들 자동 생성
    console.log('📁 필요한 폴더들을 확인하고 생성 중...');
    ensureRuntimeDirectories();

    // 2. .env 파일 자동 생성
    console.log('⚙️  환경 설정을 확인하고 생성 중...');
    createEnvFileIfNotExists();

    // 3. 데이터베이스 자동 초기화
    console.log('🗄️  데이터베이스를 초기화하는 중...');
    await initializeDatabase();
    console.log('✅ Database initialized successfully');

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

    const printBanner = (protocol: 'http' | 'https', extraLines: string[] = []) => {
      const innerWidth = 59;
      const divider = '╔' + '═'.repeat(innerWidth + 2) + '╗';
      const footer = '╚' + '═'.repeat(innerWidth + 2) + '╝';
      const formatLine = (text: string) => {
        const truncated = text.length > innerWidth ? `${text.slice(0, innerWidth - 3)}...` : text;
        return `║  ${truncated.padEnd(innerWidth)}║`;
      };

      const apiUrl = `${protocol}://${displayHost}:${PORT}`;
      const healthUrl = `${apiUrl}/health`;
      const uploadsPathRelative = path.relative(runtimePaths.basePath, uploadsDir) || '.';

      console.log(`
${divider}`);
      console.log(formatLine('🎉 Backend Server 실행 완료!'));
      console.log('╠' + '═'.repeat(innerWidth + 2) + '╣');
      console.log(formatLine(`🌐 API Server: ${apiUrl}`));
      console.log(formatLine(`📊 Health Check: ${healthUrl}`));
      console.log(formatLine(`📦 Data Root: ${runtimePaths.basePath}`));
      console.log(formatLine(`📁 Uploads: ${uploadsPathRelative}`));
      extraLines.forEach((line) => console.log(formatLine(line)));
      console.log(`${footer}
`);
    };

    const startHttpServer = (): import('http').Server =>
      app.listen(Number(PORT), bindHost, () => {
        printBanner('http');
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
        httpsServer.listen(Number(PORT), bindHost, () => {
          printBanner('https', extraLines);
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
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();







