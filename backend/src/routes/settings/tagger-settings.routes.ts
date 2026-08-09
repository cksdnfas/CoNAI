import { Router, Request, Response } from 'express';
import type { TaggerDevice, TaggerModel, TaggerSettings } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import { imageTaggerService } from '../../services/imageTaggerService';
import { autoTagScheduler } from '../../services/autoTagScheduler';
import { autoTestMediaService } from '../../services/autoTestMediaService';
import {
  sendRouteBadRequest,
  validateNumberInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routeValidation';

const router = Router();
const validTaggerModels = ['vit', 'swinv2', 'convnext'] as const;
const validTaggerDevices = ['auto', 'cpu', 'cuda'] as const;

router.get(
  '/tagger/models',
  asyncHandler(async (_req: Request, res: Response) => {
    const models = settingsService.getModelsList();
    res.json({
      success: true,
      data: models,
    });
    return;
  })
);

router.put(
  '/tagger',
  asyncHandler(async (req: Request, res: Response) => {
    const taggerSettings: Partial<TaggerSettings> = req.body;

    if (!validateNumberInRangeIfDefined(res, taggerSettings.generalThreshold, 0, 1, 'General threshold must be between 0 and 1')) return;
    if (!validateNumberInRangeIfDefined(res, taggerSettings.characterThreshold, 0, 1, 'Character threshold must be between 0 and 1')) return;
    if (!validateStringEnumIfDefined(res, taggerSettings.model, validTaggerModels, `Invalid model. Must be one of: ${validTaggerModels.join(', ')}`)) return;

    const currentSettings = settingsService.loadSettings();
    const nextEnabled = taggerSettings.enabled ?? currentSettings.tagger.enabled;
    const wasEnabled = currentSettings.tagger.enabled;

    if (!wasEnabled && nextEnabled) {
      const dependencyStatus = await imageTaggerService.checkPythonDependencies();
      if (!dependencyStatus.available) {
        sendRouteBadRequest(res, dependencyStatus.message);
        return;
      }
    }

    const updatedSettings = settingsService.updateTaggerSettings(taggerSettings);
    await imageTaggerService.reloadConfig();
    autoTagScheduler.restart();

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Tagger settings updated successfully',
    });
    return;
  })
);

router.post(
  '/tagger/check-dependencies',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await imageTaggerService.checkPythonDependencies();
    res.json({
      success: true,
      data: result,
    });
    return;
  })
);

router.post(
  '/tagger/download',
  asyncHandler(async (req: Request, res: Response) => {
    const { model } = req.body;

    if (!model || !validTaggerModels.includes(model)) {
      sendRouteBadRequest(res, 'Invalid model. Must be one of: vit, swinv2, convnext');
      return;
    }

    const isDownloaded = settingsService.isModelDownloaded(model);
    if (isDownloaded) {
      res.json({
        success: true,
        message: 'Model is already downloaded',
        data: { model, downloaded: true },
      });
      return;
    }

    res.json({
      success: true,
      message: 'Model download will occur on first use. Please tag an image to download the model.',
      data: {
        model,
        downloaded: false,
        note: 'The model will be automatically downloaded when you tag an image using this model.',
      },
    });
    return;
  })
);

router.get(
  '/tagger/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const status = await imageTaggerService.getStatus();
    res.json({ success: true, data: status });
    return;
  })
);

router.post(
  '/tagger/load-model',
  asyncHandler(async (req: Request, res: Response) => {
    const { model, device }: { model?: TaggerModel; device?: TaggerDevice } = req.body;

    if (model && !validTaggerModels.includes(model)) {
      sendRouteBadRequest(res, 'Invalid model. Must be one of: vit, swinv2, convnext');
      return;
    }

    if (device && !validTaggerDevices.includes(device)) {
      sendRouteBadRequest(res, 'Invalid device. Must be one of: auto, cpu, cuda');
      return;
    }

    await imageTaggerService.loadModel(model, device);
    res.json({ success: true, message: 'Model loaded successfully' });
    return;
  })
);

router.post(
  '/tagger/unload-model',
  asyncHandler(async (_req: Request, res: Response) => {
    await imageTaggerService.unloadModel();
    res.json({ success: true, message: 'Model unloaded successfully' });
    return;
  })
);

router.post(
  '/tagger/test',
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
      ? await imageTaggerService.tagVideo(target.resolvedPath)
      : await imageTaggerService.tagImage(target.resolvedPath);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error || 'Tagger test failed',
        details: { error_type: result.error_type },
      });
      return;
    }

    res.json({ success: true, data: result });
    return;
  })
);

export const taggerSettingsRoutes = router;
