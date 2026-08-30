import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { settingsService } from '../services/settingsService';
import {
  buildConaiHelperCustomNodeArchive,
  CONAI_HELPER_CUSTOM_NODE_PACKAGE_FILENAME,
} from '../services/conaiHelperCustomNodePackageService';
import { llmSettingsRoutes } from './settings/llm-settings.routes';
import { generalSettingsRoutes } from './settings/general-settings.routes';
import { taggerSettingsRoutes } from './settings/tagger-settings.routes';
import { kaloscopeSettingsRoutes } from './settings/kaloscope-settings.routes';
import { autoTestSettingsRoutes } from './settings/auto-test-settings.routes';
import { appearanceSettingsRoutes } from './settings/appearance.routes';
import { mediaSettingsRoutes } from './settings/media-settings.routes';
import { dataRematchSettingsRoutes } from './settings/data-rematch.routes';
import { ratingSettingsRoutes } from './settings/rating.routes';
import { runtimeSettingsRoutes } from './settings/runtime.routes';
import { mcpHttpSettingsRoutes } from './settings/mcp-http.routes';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = settingsService.loadSettings();
    res.json({
      success: true,
      data: settings,
    });
    return;
  })
);

router.get(
  '/resources/comfyui-helper/download',
  asyncHandler(async (_req: Request, res: Response) => {
    const archive = buildConaiHelperCustomNodeArchive();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${CONAI_HELPER_CUSTOM_NODE_PACKAGE_FILENAME}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(archive);
    return;
  })
);

// Keep domain mounts explicit so route ownership remains visible without
// changing the externally mounted /api/settings boundary.
router.use('/', llmSettingsRoutes);
router.use('/', generalSettingsRoutes);
router.use('/', taggerSettingsRoutes);
router.use('/', kaloscopeSettingsRoutes);
router.use('/', autoTestSettingsRoutes);
router.use('/', appearanceSettingsRoutes);
router.use('/', mediaSettingsRoutes);
router.use('/', dataRematchSettingsRoutes);
router.use('/rating', ratingSettingsRoutes);
router.use('/', runtimeSettingsRoutes);
router.use('/', mcpHttpSettingsRoutes);

export const settingsRoutes = router;
