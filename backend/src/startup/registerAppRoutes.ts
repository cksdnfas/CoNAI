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
import { mcpRoutes } from '../mcp';
import { errorHandler } from '../middleware/errorHandler';
import { optionalAuth } from '../middleware/authMiddleware';

export interface RegisterAppRoutesOptions {
  uploadsDir: string;
  tempDir: string;
  saveDir: string;
  readOnlyLimiter: RequestHandler;
  uploadLimiter: RequestHandler;
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
export function registerAppRoutes(app: Express, options: RegisterAppRoutesOptions): void {
  registerRuntimeStaticDirectory(app, '/uploads', options.uploadsDir);
  registerRuntimeStaticDirectory(app, '/temp', options.tempDir);
  registerRuntimeStaticDirectory(app, '/save', options.saveDir);

  console.log('📋 Registering API routes...');

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
  app.use('/api/images', options.readOnlyLimiter, optionalAuth, imageRoutes);
  app.use('/api/prompt-collection', options.readOnlyLimiter, optionalAuth, promptCollectionRoutes);
  app.use('/api/prompt-groups', options.readOnlyLimiter, optionalAuth, promptGroupRoutes);
  app.use('/api/negative-prompt-groups', options.readOnlyLimiter, optionalAuth, negativePromptGroupRoutes);
  app.use('/api/groups', options.readOnlyLimiter, optionalAuth, groupRoutes);
  app.use('/api/auto-folder-groups', options.readOnlyLimiter, optionalAuth, autoFolderGroupRoutes);
  app.use('/api/settings', optionalAuth, settingsRoutes);
  app.use('/api/workflows', options.readOnlyLimiter, optionalAuth, workflowRoutes);
  app.use('/api/comfyui-servers', optionalAuth, comfyuiServerRoutes);
  app.use('/api/custom-dropdown-lists', optionalAuth, customDropdownListRoutes);
  app.use('/api/custom-nodes', optionalAuth, customNodeRoutes);
  app.use('/api/module-definitions', optionalAuth, moduleDefinitionRoutes);
  app.use('/api/graph-workflows', optionalAuth, graphWorkflowRoutes);
  app.use('/api/nai', options.uploadLimiter, optionalAuth, naiRoutes);
  app.use('/api/generation-history', options.readOnlyLimiter, optionalAuth, generationHistoryRoutes);
  app.use('/api/wildcards', optionalAuth, wildcardRoutes);
  app.use('/api/folders', optionalAuth, watchedFoldersRoutes);
  app.use('/api/backup-sources', optionalAuth, backupSourcesRoutes);
  app.use('/api/search-history', optionalAuth, searchHistoryRoutes);
  app.use('/api/search-options', options.readOnlyLimiter, optionalAuth, searchOptionsRoutes);
  app.use('/api/background-queue', optionalAuth, backgroundQueueRoutes);
  app.use('/api/system', optionalAuth, systemRoutes);
  app.use('/api/image-editor', options.uploadLimiter, optionalAuth, imageEditorRoutes);
  app.use('/api/file-verification', optionalAuth, fileVerificationRoutes);
  app.use('/api/thumbnails', optionalAuth, thumbnailRoutes);

  app.use('/', mcpRoutes);
  console.log('🔌 MCP endpoint registered at /mcp');
  console.log('✅ All API routes registered successfully');

  const frontendDistCandidates = process.env.FRONTEND_DIST_PATH
    ? [path.resolve(process.env.FRONTEND_DIST_PATH)]
    : [
        path.join(__dirname, 'frontend'),
        path.join(__dirname, '..', '..', 'frontend'),
      ];
  const frontendDistPath = frontendDistCandidates.find((candidate) => fs.existsSync(candidate));

  if (frontendDistPath) {
    console.log(`🎨 Serving frontend from: ${frontendDistPath}`);
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
    console.warn('⚠️  Frontend dist not found. API-only mode.');
    console.warn(`   Tried locations: ${frontendDistCandidates.join(', ')}`);
    console.warn('   Run "npm run build:integrated" to build with frontend.\n');
  }

  app.use(errorHandler);
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });
}
