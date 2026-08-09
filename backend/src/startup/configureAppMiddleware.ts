import crypto from 'crypto';
import compression from 'compression';
import cors from 'cors';
import type { Express, Request, RequestHandler, Response as ExpressResponse } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createTieredBodyParsers, resolveRequestBodyLimitsMb } from '../middleware/requestBodyLimits';
import { logger } from '../utils/logger';

export interface AppMiddlewareConfiguration {
  isSecureContext: boolean;
  apiLimiter: RequestHandler;
  uploadLimiter: RequestHandler;
  readOnlyLimiter: RequestHandler;
}

export interface AppMiddlewareDependencies {
  createBodyParsers(): ReturnType<typeof createTieredBodyParsers>;
  createCompression(options: Parameters<typeof compression>[0]): RequestHandler;
  createCors(options: Parameters<typeof cors>[0]): RequestHandler;
  createHelmet(options: Parameters<typeof helmet>[0]): RequestHandler;
  createRateLimiter(options: Parameters<typeof rateLimit>[0]): RequestHandler;
  defaultCompressionFilter: typeof compression.filter;
  log(message: string): void;
  randomNonce(): string;
  resolveBodyLimitsMb(): ReturnType<typeof resolveRequestBodyLimitsMb>;
}

const productionMiddlewareDependencies: AppMiddlewareDependencies = {
  createBodyParsers: () => createTieredBodyParsers(),
  createCompression: (options) => compression(options),
  createCors: (options) => cors(options),
  createHelmet: (options) => helmet(options),
  createRateLimiter: (options) => rateLimit(options),
  defaultCompressionFilter: compression.filter,
  log: (message) => console.log(message),
  randomNonce: () => crypto.randomBytes(16).toString('base64'),
  resolveBodyLimitsMb: () => resolveRequestBodyLimitsMb(),
};

/** Resolve the Express trust-proxy setting for direct and proxied deployments. */
export function resolveTrustProxySetting(env: NodeJS.ProcessEnv = process.env) {
  const configuredValue = env.TRUST_PROXY?.trim();

  if (!configuredValue) {
    const hasExternalOriginHint = Boolean(env.PUBLIC_BASE_URL || env.BACKEND_HOST || env.PUBLIC_HOST);
    const usesHttpsOrigin = (env.BACKEND_PROTOCOL || '').toLowerCase() === 'https';
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

/** Install request middleware in the order required by the runtime and return route-scoped limiters. */
export function configureAppMiddleware(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: AppMiddlewareDependencies = productionMiddlewareDependencies,
): AppMiddlewareConfiguration {
  const trustProxySetting = resolveTrustProxySetting(env);
  app.set('trust proxy', trustProxySetting);
  dependencies.log(`[Config] Express trust proxy: ${String(trustProxySetting)}`);

  const skipAdminRateLimit = (req: Request): boolean => req.session?.accountType === 'admin';

  // SSE 스트림은 연결 1건이 요청 1건으로 카운트된다. 재접속 백오프가 겹치면 일반 API 예산을
  // 갉아먹으므로 스트림 경로만 레이트 리밋에서 제외한다.
  const isRuntimeEventStreamRequest = (req: Request): boolean => req.originalUrl.startsWith('/api/events/');
  const skipApiRateLimit = (req: Request): boolean => skipAdminRateLimit(req) || isRuntimeEventStreamRequest(req);

  const apiLimiter = dependencies.createRateLimiter({
    windowMs: 1 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipApiRateLimit,
  });

  const uploadLimiter = dependencies.createRateLimiter({
    windowMs: 1 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipAdminRateLimit,
    handler: (req, res) => {
      logger.warn(`[UploadAudit] ${JSON.stringify({
        event: 'upload.denied',
        scope: 'rate-limit',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: 429,
        accountId: req.session?.accountId ?? null,
        accountType: req.session?.accountType ?? (req.session?.authenticated ? 'bootstrap' : 'anonymous'),
        ip: req.ip,
        fileCount: 0,
        totalBytes: 0,
        reason: 'rate_limit',
      })}`);
      res.status(429).json({ error: 'Too many upload requests, please slow down' });
    },
  });

  const readOnlyLimiter = dependencies.createRateLimiter({
    windowMs: 1 * 60 * 1000,
    max: 2000,
    message: 'Too many read requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipAdminRateLimit,
  });

  const isSecureContext = (env.BACKEND_PROTOCOL || '').toLowerCase() === 'https';

  app.use((_req, res, next) => {
    res.locals.cspNonce = dependencies.randomNonce();
    next();
  });

  app.use(dependencies.createHelmet({
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
        'upgrade-insecure-requests': null,
        'connect-src': ["'self'", 'http://localhost:*', 'ws:', 'wss:'],
        'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
        'media-src': ["'self'", 'blob:', 'http:', 'https:'],
      },
    },
  }));

  app.use(dependencies.createCors({
    origin: (_origin, callback) => {
      callback(null, true);
    },
    credentials: true,
  }));

  app.use(dependencies.createCompression({
    threshold: 1024,
    filter: (req, res) => {
      const contentType = String(res.getHeader('Content-Type') ?? '');
      if (contentType.includes('event-stream')) {
        return false;
      }
      return dependencies.defaultCompressionFilter(req, res);
    },
  }));

  // 요청 바디 한도는 API 마운트별로 스코프된다. 50MB 전역 한도는 익명 접근 가능한 검색 라우트까지
  // 단일 이벤트 루프에서 50MB 버퍼링+동기 파싱을 하도록 허용했다. 상세 근거는 requestBodyLimits.ts 참고.
  const tieredBodyParsers = dependencies.createBodyParsers();
  app.use(tieredBodyParsers.json);
  app.use(tieredBodyParsers.urlencoded);
  dependencies.log(
    `[Config] JSON body limits (MB): ${Object.entries(dependencies.resolveBodyLimitsMb())
      .map(([tier, limitMb]) => `${tier}=${limitMb}`)
      .join(', ')}`,
  );

  return {
    isSecureContext,
    apiLimiter,
    uploadLimiter,
    readOnlyLimiter,
  };
}
