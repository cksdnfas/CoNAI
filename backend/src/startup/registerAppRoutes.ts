import { IMAGE_VIEW_PERMISSION } from '@conai/shared';
import { allowImagesView, requireImagesView } from '../middleware/imageAccess';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { imageRoutes } from '../routes/images/index';
import { isImageUploadPayloadRequest } from '../routes/images/uploadSecurity';
import promptCollectionRoutes from '../routes/promptCollection';
import promptGroupRoutes from '../routes/promptGroups';
import negativePromptGroupRoutes from '../routes/negativePromptGroups';
import { groupRoutes } from '../routes/groups';
import autoFolderGroupRoutes from '../routes/autoFolderGroups';
import { settingsRoutes } from '../routes/settings';
import { workflowRoutes } from '../routes/workflows';
import { comfyuiServerRoutes } from '../routes/comfyuiServers';
import { customDropdownListRoutes } from '../routes/customDropdownLists';
import { customNodeRoutes } from '../routes/customNodes.routes';
import { moduleDefinitionRoutes } from '../routes/moduleDefinitions';
import { graphWorkflowRoutes } from '../routes/graphWorkflows';
import naiRoutes from '../routes/nai';
import generationHistoryRoutes from '../routes/generation-history.routes';
import generationQueueRoutes from '../routes/generation-queue.routes';
import codexChatRoutes from '../routes/codex-chat.routes';
import chatProposalRoutes from '../routes/chat-proposals.routes';
import chatRoutineRoutes from '../routes/chat-routines.routes';
import filesRoutes from '../routes/files.routes';
import postsRoutes from '../routes/posts.routes';
import audioRoutes from '../routes/audio.routes';
import audioLegacyImportRoutes from '../routes/audio-legacy-import.routes';
import { isAudioStorePath } from '../services/audio/audioStore';
import systemFolderRoutes from '../routes/system-folders.routes';
import { wildcardMutationRoutes } from '../routes/wildcards.mutation.routes';
import { wildcardReadRoutes } from '../routes/wildcards.read.routes';
import { wildcardUtilityRoutes } from '../routes/wildcards.utility.routes';
import { watchedFoldersRoutes } from '../routes/watchedFolders';
import { backupSourcesRoutes } from '../routes/backupSources';
import { backgroundQueueRoutes } from '../routes/backgroundQueue';
import { systemRoutes } from '../routes/system.routes';
import imageEditorRoutes from '../routes/image-editor.routes';
import { authRoutes } from '../routes/auth.routes';
import fileVerificationRoutes from '../routes/fileVerification';
import { thumbnailRoutes } from '../routes/thumbnails';
import { runtimeJobRoutes } from '../routes/runtime-jobs.routes';
import externalApiRoutes from '../routes/externalApi.routes';
import civitaiRoutes from '../routes/civitai.routes';
import searchHistoryRoutes from '../routes/search-history.routes';
import searchOptionsRoutes from '../routes/search-options.routes';
import { danbooruBrowserRoutes } from '../routes/danbooruBrowser.routes';
import { promptPresetRoutes } from '../routes/prompt-presets.routes';
import { wallpaperRuntimeRoutes } from '../routes/wallpaperRuntime.routes';
import { runtimeAppearanceRoutes } from '../routes/runtimeAppearance.routes';
import { runtimeMediaSettingsRoutes } from '../routes/runtime-media-settings.routes';
import publicWorkflowRoutes from '../routes/public-workflows.routes';
import { workflowInputAssetRoutes } from '../routes/workflow-input-assets.routes';
import { runtimeEventStreamRoutes } from '../routes/events/event-stream.routes';
import spriteRoutes from '../routes/sprite.routes';
import { mcpRoutes } from '../mcp';
import { errorHandler } from '../middleware/errorHandler';
import {
  allowAnonymousAnyPermission,
  optionalAuth,
  requireAdmin,
  requireAuth,
  requirePermission,
} from '../middleware/authMiddleware';
import { buildAuthStatusPayload } from '../routes/auth-route-helpers';
import { settingsService } from '../services/settingsService';

export interface RegisterAppRoutesOptions {
  uploadsDir: string;
  tempDir: string;
  saveDir: string;
  mcpLimiter: RequestHandler;
  readOnlyLimiter: RequestHandler;
  uploadLimiter: RequestHandler;
}

export interface RegisterAppRoutesResult {
  frontendMode: 'integrated' | 'api-only';
  frontendDistPath: string | null;
}

/** Register one authenticated runtime directory with shared cache headers. */
function registerRuntimeStaticDirectory(app: Express, mountPath: string, directoryPath: string): void {
  app.use(mountPath, requireAuth, requireImagesView, express.static(directoryPath, {
    setHeaders: (res) => {
      // Files can be replaced in place at the same URL and may contain private user media.
      res.setHeader('Cache-Control', 'private, no-cache');
    },
    etag: true,
    lastModified: true,
    maxAge: '1d',
  }));
}

/** Serialize one frontend bootstrap payload so it can be embedded into HTML safely. */
function serializeFrontendBootstrap(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Render the integrated frontend index with auth and appearance bootstrap payloads. */
function renderIntegratedFrontendIndex(req: Request, res: Response, htmlTemplate: string): string {
  const authStatus = buildAuthStatusPayload(req);
  const appearance = settingsService.loadSettings().appearance;
  const bootstrapScriptNonce = res.locals.cspNonce as string | undefined;
  const nonceAttribute = bootstrapScriptNonce ? ` nonce="${bootstrapScriptNonce}"` : '';
  const bootstrapScript = [
    `<script${nonceAttribute}>window.__CONAI_AUTH_STATUS__=${serializeFrontendBootstrap(authStatus)};</script>`,
    `<script${nonceAttribute}>window.__CONAI_APPEARANCE__=${serializeFrontendBootstrap(appearance)};</script>`,
  ].join('');

  return htmlTemplate.includes('</head>')
    ? htmlTemplate.replace('</head>', `${bootstrapScript}</head>`)
    : `${bootstrapScript}${htmlTemplate}`;
}

function isReadMethod(req: Request): boolean {
  return req.method === 'GET' || req.method === 'HEAD';
}

function isImageReadRequest(req: Request): boolean {
  if (isReadMethod(req)) {
    return true;
  }

  if (req.method !== 'POST') {
    return false;
  }

  return [
    '/batch',
    '/download/batch',
    '/random-from-search',
    '/search',
    '/search/ids',
    '/search-by-autotags',
    '/search/complex',
    '/search/complex/ids',
    '/search/complex/validate',
  ].includes(req.path);
}

function allowReadAccess(permissionKeys: readonly string[], readPostPaths: readonly string[] = []): RequestHandler {
  return (req, res, next) => {
    if (isReadMethod(req) || (req.method === 'POST' && readPostPaths.includes(req.path))) {
      allowAnonymousAnyPermission(permissionKeys)(req, res, next);
      return;
    }

    optionalAuth(req, res, next);
  };
}

/** Preserve the existing authenticated data boundary while authorizing reads by feature. */
function requireReadAccess(permissionKey: string, readPostPaths: readonly string[] = []): RequestHandler {
  return (req, res, next) => {
    if (isReadMethod(req) || (req.method === 'POST' && readPostPaths.includes(req.path))) requirePermission(permissionKey)(req, res, next);
    else optionalAuth(req, res, next);
  };
}

/** Register API routes, runtime static directories, frontend assets, and terminal handlers. */
export function registerAppRoutes(app: Express, options: RegisterAppRoutesOptions): RegisterAppRoutesResult {
  // The audio store lives under uploads but is only served through /api/audio (audio.view), never statically.
  // Resolve the request like serve-static would, so `//audio`, `%2e%2e` or case tricks cannot reach it either.
  app.use('/uploads', (req, res, next) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {
      next();
      return;
    }
    if (isAudioStorePath(path.join(options.uploadsDir, path.normalize(decoded)))) {
      res.status(404).end();
      return;
    }
    next();
  });
  registerRuntimeStaticDirectory(app, '/uploads', options.uploadsDir);
  registerRuntimeStaticDirectory(app, '/temp', options.tempDir);
  registerRuntimeStaticDirectory(app, '/save', options.saveDir);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.use('/api/auth', authRoutes);
  // 런타임 이벤트 스트림은 수십 분 열려 있으므로 세션을 변조하는 공용 인증 미들웨어를 쓰지 않는다.
  // 인증/권한은 라우트 내부의 read-only 가드(resolveEventStreamAccess)가 직접 해석한다.
  app.use('/api/events', runtimeEventStreamRoutes);
  app.use('/api/external-api', optionalAuth, externalApiRoutes);
  app.use('/api/civitai', options.readOnlyLimiter, optionalAuth, civitaiRoutes);
  app.use('/api/wallpaper-runtime', options.readOnlyLimiter, (req, res, next) => {
    if (req.path === '/browse-content' || /^\/groups\/[^/]+\/preview-images$/.test(req.path)) {
      allowImagesView(req, res, next);
      return;
    }
    next(); // Sanitized wallpaper settings are public runtime preferences.
  }, wallpaperRuntimeRoutes);
  app.use('/api/images', options.readOnlyLimiter, (req, res, next) => {
    if (isImageUploadPayloadRequest(req)) {
      options.uploadLimiter(req, res, next);
      return;
    }

    next();
  }, (req, res, next) => {
    // Multipart routes own their exact operation permission before Multer writes
    // any bytes. Let those route-local guards produce auditable 401/403 results.
    if (isImageUploadPayloadRequest(req)) {
      next();
      return;
    }

    if (isImageReadRequest(req)) {
      allowImagesView(req, res, next);
      return;
    }

    optionalAuth(req, res, next);
  }, imageRoutes);
  app.use('/api/prompt-collection', options.readOnlyLimiter, requireReadAccess('prompts.view', ['/resolve-groups']), promptCollectionRoutes);
  app.use('/api/danbooru-browser', options.readOnlyLimiter, requireReadAccess('prompts.view'), danbooruBrowserRoutes);
  app.use('/api/prompt-groups', options.readOnlyLimiter, requireReadAccess('prompts.view'), promptGroupRoutes);
  app.use('/api/negative-prompt-groups', options.readOnlyLimiter, requireReadAccess('prompts.view'), negativePromptGroupRoutes);
  app.use('/api/prompt-presets', requireReadAccess('prompts.view'), promptPresetRoutes);
  app.use('/api/groups', options.readOnlyLimiter, groupRoutes);
  app.use('/api/auto-folder-groups', options.readOnlyLimiter, autoFolderGroupRoutes);
  app.get('/api/settings/appearance-public', options.readOnlyLimiter, (_req, res) => {
    res.json({
      success: true,
      data: settingsService.loadSettings().appearance,
    });
  });
  app.get('/api/settings/header-navigation-public', options.readOnlyLimiter, (_req, res) => {
    res.json({
      success: true,
      data: settingsService.loadSettings().general.headerNavigation,
    });
  });
  app.use('/api/runtime-appearance', optionalAuth, runtimeAppearanceRoutes);
  app.get('/api/runtime-settings/language', options.readOnlyLimiter, (_req, res) => {
    res.json({ success: true, data: { general: { language: settingsService.loadSettings().general.language } } });
  });
  app.get('/api/runtime-settings/image-save', options.readOnlyLimiter, requireAuth, allowAnonymousAnyPermission(['images.view', 'generation.execute', 'workflows.view', 'images.upload']), (_req, res) => {
    res.json({ success: true, data: { imageSave: settingsService.loadSettings().imageSave } });
  });
  app.get('/api/runtime-settings/workflows', options.readOnlyLimiter, requirePermission('workflows.view'), (_req, res) => {
    const { tagger, kaloscope } = settingsService.loadSettings();
    res.json({ success: true, data: { tagger: { enabled: tagger.enabled }, kaloscope: { enabled: kaloscope.enabled } } });
  });
  app.use('/api/runtime-media-settings', options.readOnlyLimiter, allowReadAccess([IMAGE_VIEW_PERMISSION]), runtimeMediaSettingsRoutes);
  app.use('/api/settings', requireAdmin, settingsRoutes);
  app.use('/api/workflow-input-assets', options.uploadLimiter, requireAuth, workflowInputAssetRoutes);
  app.use('/api/workflows', options.readOnlyLimiter, requireReadAccess('workflows.view'), workflowRoutes);
  app.use('/api/public-workflows', requireAuth, publicWorkflowRoutes);
  app.use('/api/comfyui-servers', requireReadAccess('workflows.view'), comfyuiServerRoutes);
  app.use('/api/custom-dropdown-lists', (req, res, next) => {
    // Bitmap URLs are also consumed by published workflows without global workflow-data access.
    if (isReadMethod(req) && req.path === '/comfy-model-thumbnail') optionalAuth(req, res, next);
    else requireReadAccess('workflows.view')(req, res, next);
  }, customDropdownListRoutes);
  app.use('/api/custom-nodes', requireReadAccess('workflows.view'), customNodeRoutes);
  app.use('/api/module-definitions', requireReadAccess('workflows.view'), moduleDefinitionRoutes);
  app.use('/api/graph-workflows', (req, res, next) => {
    const readsMedia = isReadMethod(req) && (req.path === '/browse-content' || /^\/executions\/(?:previews|\d+)$/.test(req.path));
    if (readsMedia) requirePermission('workflows.view')(req, res, () => requireImagesView(req, res, next));
    else requireReadAccess('workflows.view')(req, res, next);
  }, graphWorkflowRoutes);
  app.use('/api/nai', options.uploadLimiter, optionalAuth, naiRoutes);
  app.use('/api/generation-history', options.readOnlyLimiter, optionalAuth, generationHistoryRoutes);
  app.use('/api/generation-queue', requireAuth, generationQueueRoutes);
  app.use('/api/codex-chat', requireAuth, codexChatRoutes);
  app.use('/api/chat-proposals', requireAuth, chatProposalRoutes);
  app.use('/api/chat-routines', requireAuth, chatRoutineRoutes);
  app.use('/api/files', requireAuth, (req, res, next) => {
    const limiter = req.method === 'POST' && req.path === '/upload' ? options.uploadLimiter : options.readOnlyLimiter;
    limiter(req, res, next);
  }, filesRoutes);
  app.use('/api/posts', requireAuth, options.readOnlyLimiter, postsRoutes);
  // Admin only; mounted ahead of /api/audio so the import does not also need the workspace keys.
  app.use('/api/audio/legacy-import', requireAuth, options.uploadLimiter, audioLegacyImportRoutes);
  app.use('/api/audio', requireAuth, (req, res, next) => {
    const limiter = req.method === 'POST' && /\/upload$/.test(req.path) ? options.uploadLimiter : options.readOnlyLimiter;
    limiter(req, res, next);
  }, audioRoutes);
  app.use('/api/system-folders', requireAuth, options.readOnlyLimiter, systemFolderRoutes);
  app.use('/api/wildcards', wildcardUtilityRoutes);
  app.use('/api/wildcards', optionalAuth, wildcardMutationRoutes);
  app.use('/api/wildcards', wildcardReadRoutes);
  app.use('/api/folders', requireAdmin, watchedFoldersRoutes);
  app.use('/api/backup-sources', requireAdmin, backupSourcesRoutes);
  app.use('/api/search-history', optionalAuth, searchHistoryRoutes);
  app.use('/api/search-options', options.readOnlyLimiter, allowReadAccess([IMAGE_VIEW_PERMISSION]), searchOptionsRoutes);
  app.use('/api/background-queue', requireReadAccess('workflows.view'), backgroundQueueRoutes);
  app.use('/api/system', requireAdmin, systemRoutes);
  app.use('/api/image-editor', options.uploadLimiter, optionalAuth, imageEditorRoutes);
  app.use('/api/file-verification', requireAdmin, fileVerificationRoutes);
  app.use('/api/thumbnails', optionalAuth, thumbnailRoutes);
  // 장기 실행 잡의 진행률/취소 공용 라우트. 잡을 시작하는 라우트는 각자의 기존 권한을 유지한다.
  app.use('/api/jobs', optionalAuth, runtimeJobRoutes);
  app.use('/api/sprite', spriteRoutes);

  app.use('/', mcpRoutes);

  const frontendDistCandidates = process.env.FRONTEND_DIST_PATH
    ? [path.resolve(process.env.FRONTEND_DIST_PATH)]
    : [
        path.resolve(process.cwd(), 'dist', 'frontend'),
        path.resolve(process.cwd(), 'frontend'),
        path.resolve(process.cwd(), 'app', 'frontend'),
        path.resolve(process.cwd(), '..', 'frontend', 'dist'),
        path.join(__dirname, '..', '..', '..', 'frontend'),
        path.join(__dirname, '..', '..', '..', '..', 'frontend', 'dist'),
      ];
  const frontendDistPath = frontendDistCandidates.find((candidate) => fs.existsSync(candidate));

  if (frontendDistPath) {
    const indexPath = path.join(frontendDistPath, 'index.html');
    const indexHtmlTemplate = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;

    app.use(express.static(frontendDistPath, {
      etag: true,
      index: false,
      lastModified: true,
      setHeaders: (res, filePath) => {
        const normalizedPath = filePath.replace(/\\/g, '/');

        if (normalizedPath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }

        if (normalizedPath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    }));

    const handleFrontendIndex: RequestHandler = (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/temp') || req.path.startsWith('/save')) {
        next();
        return;
      }

      if (!indexHtmlTemplate) {
        next();
        return;
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.type('html').send(renderIntegratedFrontendIndex(req, res, indexHtmlTemplate));
    };

    app.get('/', handleFrontendIndex);
    app.get('/{*path}', handleFrontendIndex);
  } else {
    console.warn('⚠️  Frontend build not found. Backend is running in API-only mode.');
    console.warn('   Before integrated build, open the frontend dev server on http://localhost:1677');
    console.warn('   After "npm run build:integrated", open the app on the backend port instead.');
  }

  app.use(errorHandler);
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return {
    frontendMode: frontendDistPath ? 'integrated' : 'api-only',
    frontendDistPath: frontendDistPath || null,
  };
}
