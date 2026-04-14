import express, { type Express, type RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { imageRoutes } from '../routes/images/index';
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
import wildcardRoutes from '../routes/wildcards';
import { watchedFoldersRoutes } from '../routes/watchedFolders';
import { backupSourcesRoutes } from '../routes/backupSources';
import { backgroundQueueRoutes } from '../routes/backgroundQueue';
import { systemRoutes } from '../routes/system.routes';
import imageEditorRoutes from '../routes/image-editor.routes';
import { authRoutes } from '../routes/auth.routes';
import fileVerificationRoutes from '../routes/fileVerification';
import { thumbnailRoutes } from '../routes/thumbnails';
import externalApiRoutes from '../routes/externalApi.routes';
import civitaiRoutes from '../routes/civitai.routes';
import searchHistoryRoutes from '../routes/search-history.routes';
import searchOptionsRoutes from '../routes/search-options.routes';
import { wallpaperRuntimeRoutes } from '../routes/wallpaperRuntime.routes';
import { mcpRoutes } from '../mcp';
import { errorHandler } from '../middleware/errorHandler';
import { allowAnonymousPermission, optionalAuth, requirePermission } from '../middleware/authMiddleware';

export interface RegisterAppRoutesOptions {
  uploadsDir: string;
  tempDir: string;
  saveDir: string;
  readOnlyLimiter: RequestHandler;
  uploadLimiter: RequestHandler;
}

export interface RegisterAppRoutesResult {
  frontendMode: 'integrated' | 'api-only';
  frontendDistPath: string | null;
}

/** Register one static runtime directory with shared CORS and cache headers. */
function registerRuntimeStaticDirectory(app: Express, mountPath: string, directoryPath: string): void {
  app.use(mountPath, optionalAuth, express.static(directoryPath, {
    setHeaders: (res, filePath) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
    etag: true,
    lastModified: true,
    maxAge: '1y',
  }));
}

/** Register API routes, runtime static directories, frontend assets, and terminal handlers. */
export function registerAppRoutes(app: Express, options: RegisterAppRoutesOptions): RegisterAppRoutesResult {
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
  app.use('/api/external-api', optionalAuth, externalApiRoutes);
  app.use('/api/civitai', options.readOnlyLimiter, optionalAuth, civitaiRoutes);
  app.use('/api/wallpaper-runtime', options.readOnlyLimiter, (req, res, next) => {
    if (req.session?.authenticated === true) {
      optionalAuth(req, res, next);
      return;
    }

    allowAnonymousPermission('page.wallpaper.runtime.view')(req, res, next);
  }, wallpaperRuntimeRoutes);
  app.use('/api/images', options.readOnlyLimiter, (req, res, next) => {
    const isWallpaperRuntimeThumbnailRequest = (req.method === 'GET' || req.method === 'HEAD')
      && /^\/[^/]+\/thumbnail$/.test(req.path);

    if (isWallpaperRuntimeThumbnailRequest) {
      if (req.session?.authenticated === true) {
        optionalAuth(req, res, next);
        return;
      }

      allowAnonymousPermission('page.wallpaper.runtime.view')(req, res, next);
      return;
    }

    optionalAuth(req, res, next);
  }, imageRoutes);
  app.use('/api/prompt-collection', options.readOnlyLimiter, optionalAuth, requirePermission('page.prompts.view'), promptCollectionRoutes);
  app.use('/api/prompt-groups', options.readOnlyLimiter, optionalAuth, requirePermission('page.prompts.view'), promptGroupRoutes);
  app.use('/api/negative-prompt-groups', options.readOnlyLimiter, optionalAuth, requirePermission('page.prompts.view'), negativePromptGroupRoutes);
  app.use('/api/groups', options.readOnlyLimiter, optionalAuth, requirePermission('page.groups.view'), groupRoutes);
  app.use('/api/auto-folder-groups', options.readOnlyLimiter, optionalAuth, requirePermission('page.groups.view'), autoFolderGroupRoutes);
  app.use('/api/settings', optionalAuth, requirePermission('page.settings.view'), settingsRoutes);
  app.use('/api/workflows', options.readOnlyLimiter, optionalAuth, requirePermission('page.generation.view'), workflowRoutes);
  app.use('/api/comfyui-servers', optionalAuth, requirePermission('page.generation.view'), comfyuiServerRoutes);
  app.use('/api/custom-dropdown-lists', optionalAuth, requirePermission('page.generation.view'), customDropdownListRoutes);
  app.use('/api/custom-nodes', optionalAuth, requirePermission('page.generation.view'), customNodeRoutes);
  app.use('/api/module-definitions', optionalAuth, requirePermission('page.generation.view'), moduleDefinitionRoutes);
  app.use('/api/graph-workflows', optionalAuth, requirePermission('page.generation.view'), graphWorkflowRoutes);
  app.use('/api/nai', options.uploadLimiter, optionalAuth, requirePermission('page.generation.view'), naiRoutes);
  app.use('/api/generation-history', options.readOnlyLimiter, optionalAuth, requirePermission('page.generation.view'), generationHistoryRoutes);
  app.use('/api/generation-queue', optionalAuth, requirePermission('page.generation.view'), generationQueueRoutes);
  app.use('/api/wildcards', optionalAuth, requirePermission('page.generation.view'), wildcardRoutes);
  app.use('/api/folders', optionalAuth, watchedFoldersRoutes);
  app.use('/api/backup-sources', optionalAuth, backupSourcesRoutes);
  app.use('/api/search-history', optionalAuth, searchHistoryRoutes);
  app.use('/api/search-options', options.readOnlyLimiter, optionalAuth, searchOptionsRoutes);
  app.use('/api/background-queue', optionalAuth, requirePermission('page.generation.view'), backgroundQueueRoutes);
  app.use('/api/system', optionalAuth, systemRoutes);
  app.use('/api/image-editor', options.uploadLimiter, optionalAuth, imageEditorRoutes);
  app.use('/api/file-verification', optionalAuth, fileVerificationRoutes);
  app.use('/api/thumbnails', optionalAuth, thumbnailRoutes);

  app.use('/', mcpRoutes);

  const frontendDistCandidates = process.env.FRONTEND_DIST_PATH
    ? [path.resolve(process.env.FRONTEND_DIST_PATH)]
    : [
        path.join(__dirname, 'frontend'),
        path.join(__dirname, '..', '..', 'frontend'),
      ];
  const frontendDistPath = frontendDistCandidates.find((candidate) => fs.existsSync(candidate));

  if (frontendDistPath) {
    app.use(express.static(frontendDistPath));

    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/temp') || req.path.startsWith('/save')) {
        next();
        return;
      }

      const indexPath = path.join(frontendDistPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
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
