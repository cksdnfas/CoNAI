import { Router, Request, Response } from 'express';
import type { KaloscopeSettings } from '@conai/shared';
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '../../constants/settings';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import { kaloscopeTaggerService } from '../../services/kaloscopeTaggerService';
import { autoTagScheduler } from '../../services/autoTagScheduler';
import { autoTestMediaService } from '../../services/autoTestMediaService';
import {
  sendRouteBadRequest,
  validateIntegerInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routeValidation';

const router = Router();
const validKaloscopeDevices = ['auto', 'cpu', 'cuda'] as const;

router.put(
  '/kaloscope',
  asyncHandler(async (req: Request, res: Response) => {
    const kaloscopeSettings: Partial<KaloscopeSettings> = req.body;

    if (!validateStringEnumIfDefined(res, kaloscopeSettings.device, validKaloscopeDevices, `Invalid device. Must be one of: ${validKaloscopeDevices.join(', ')}`)) return;
    if (!validateIntegerInRangeIfDefined(res, kaloscopeSettings.topK, 1, 200, 'topK must be an integer between 1 and 200')) return;

    if (kaloscopeSettings.autoUnloadMinutes !== undefined) {
      if (!Number.isInteger(kaloscopeSettings.autoUnloadMinutes) || kaloscopeSettings.autoUnloadMinutes < 1) {
        sendRouteBadRequest(res, 'autoUnloadMinutes must be an integer greater than or equal to 1');
        return;
      }
    }

    if (kaloscopeSettings.artistLinkUrlTemplate !== undefined) {
      const normalizedTemplate = String(kaloscopeSettings.artistLinkUrlTemplate).trim();
      if (!normalizedTemplate) {
        sendRouteBadRequest(res, 'artistLinkUrlTemplate must not be empty');
        return;
      }
      if (!normalizedTemplate.includes('{key}')) {
        sendRouteBadRequest(res, `artistLinkUrlTemplate must include {key}. Example: ${DEFAULT_ARTIST_LINK_URL_TEMPLATE}`);
        return;
      }
      kaloscopeSettings.artistLinkUrlTemplate = normalizedTemplate;
    }

    const currentSettings = settingsService.loadSettings();
    const nextEnabled = kaloscopeSettings.enabled ?? currentSettings.kaloscope.enabled;
    const wasEnabled = currentSettings.kaloscope.enabled;

    if (!wasEnabled && nextEnabled) {
      const dependencyStatus = await kaloscopeTaggerService.checkDependencies();
      if (!dependencyStatus.available) {
        sendRouteBadRequest(res, dependencyStatus.message);
        return;
      }
    }

    const updatedSettings = settingsService.updateKaloscopeSettings(kaloscopeSettings);
    await kaloscopeTaggerService.reloadConfig();
    autoTagScheduler.restart();

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Kaloscope settings updated successfully',
    });
    return;
  })
);

router.get(
  '/kaloscope/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await kaloscopeTaggerService.getServerStatus();
    res.json({ success: true, data: status });
    return;
  })
);

router.post(
  '/kaloscope/load-model',
  asyncHandler(async (_req: Request, res: Response) => {
    await kaloscopeTaggerService.loadModel();
    res.json({ success: true, message: 'Model loaded successfully' });
    return;
  })
);

router.post(
  '/kaloscope/unload-model',
  asyncHandler(async (_req: Request, res: Response) => {
    await kaloscopeTaggerService.unloadModel();
    res.json({ success: true, message: 'Model unloaded successfully' });
    return;
  })
);

router.post(
  '/kaloscope/test',
  asyncHandler(async (req: Request, res: Response) => {
    const imageId = String(req.body?.imageId || '').trim();
    if (!imageId) {
      sendRouteBadRequest(res, 'imageId is required');
      return;
    }

    const target = autoTestMediaService.resolveFileTarget(imageId);
    if (!target || !target.originalFilePath) {
      res.status(404).json({ success: false, error: 'Image not found or no active file' });
      return;
    }
    if (!target.resolvedPath || !target.existsOnDisk) {
      res.status(404).json({ success: false, error: 'Image file not found on disk' });
      return;
    }

    const result = target.fileType === 'video'
      ? await kaloscopeTaggerService.tagVideo(target.resolvedPath)
      : await kaloscopeTaggerService.tagImage(target.resolvedPath);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error || 'Kaloscope test failed',
        details: { error_type: result.error_type },
      });
      return;
    }

    res.json({ success: true, data: result });
    return;
  })
);

export const kaloscopeSettingsRoutes = router;
