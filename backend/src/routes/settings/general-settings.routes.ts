import { Router, Request, Response } from 'express';
import {
  HEADER_NAVIGATION_ITEM_KEYS,
  type GeneralSettings,
  type ImageSimilarityCheckMode,
  type SupportedLanguage,
} from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import {
  sendRouteBadRequest,
  validateBooleanIfDefined,
  validateIntegerInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routeValidation';
import {
  MAX_GENERATION_HISTORY_MAX_ITEMS,
  MIN_GENERATION_HISTORY_MAX_ITEMS,
} from '../../constants/generationHistory';
import { requestGenerationResultRetentionPrune } from '../../services/generationResultRetentionService';

const router = Router();
const validLanguages: SupportedLanguage[] = ['ko', 'en'];
const validImageSimilarityCheckModes: ImageSimilarityCheckMode[] = ['manual', 'always'];
const validHeaderNavigationItemKeys = new Set<string>(HEADER_NAVIGATION_ITEM_KEYS);

router.put(
  '/general',
  asyncHandler(async (req: Request, res: Response) => {
    const generalSettings: Partial<GeneralSettings> = req.body;

    if (!validateStringEnumIfDefined(res, generalSettings.language, validLanguages, `Invalid language. Must be one of: ${validLanguages.join(', ')}`)) return;
    if (!validateStringEnumIfDefined(res, generalSettings.imageSimilarityCheckMode, validImageSimilarityCheckModes, `Invalid image similarity check mode. Must be one of: ${validImageSimilarityCheckModes.join(', ')}`)) return;
    if (!validateBooleanIfDefined(res, generalSettings.applyRatingSafetyToGenerationHistory, 'applyRatingSafetyToGenerationHistory must be a boolean')) return;
    if (!validateIntegerInRangeIfDefined(
      res,
      generalSettings.generationHistoryMaxItems,
      MIN_GENERATION_HISTORY_MAX_ITEMS,
      MAX_GENERATION_HISTORY_MAX_ITEMS,
      `generationHistoryMaxItems must be an integer between ${MIN_GENERATION_HISTORY_MAX_ITEMS} and ${MAX_GENERATION_HISTORY_MAX_ITEMS}`,
    )) return;

    if (generalSettings.deleteProtection !== undefined) {
      if (generalSettings.deleteProtection && typeof generalSettings.deleteProtection !== 'object') {
        sendRouteBadRequest(res, 'deleteProtection must be an object');
        return;
      }

      if (
        generalSettings.deleteProtection?.enabled !== undefined
        && typeof generalSettings.deleteProtection.enabled !== 'boolean'
      ) {
        sendRouteBadRequest(res, 'deleteProtection.enabled must be a boolean');
        return;
      }

      if (
        generalSettings.deleteProtection?.recycleBinPath !== undefined
        && (typeof generalSettings.deleteProtection.recycleBinPath !== 'string' || generalSettings.deleteProtection.recycleBinPath.trim().length === 0)
      ) {
        sendRouteBadRequest(res, 'deleteProtection.recycleBinPath must be a non-empty string');
        return;
      }
    }

    if (generalSettings.headerNavigation !== undefined) {
      if (!generalSettings.headerNavigation || typeof generalSettings.headerNavigation !== 'object') {
        sendRouteBadRequest(res, 'headerNavigation must be an object');
        return;
      }

      for (const [key, value] of Object.entries(generalSettings.headerNavigation)) {
        if (!validHeaderNavigationItemKeys.has(key)) {
          sendRouteBadRequest(res, `Invalid headerNavigation key: ${key}`);
          return;
        }

        if (typeof value !== 'boolean') {
          sendRouteBadRequest(res, `headerNavigation.${key} must be a boolean`);
          return;
        }
      }
    }

    const updatedSettings = settingsService.updateGeneralSettings(generalSettings);
    if (generalSettings.generationHistoryMaxItems !== undefined) {
      requestGenerationResultRetentionPrune(updatedSettings.general.generationHistoryMaxItems);
    }

    res.json({
      success: true,
      data: updatedSettings,
      message: 'General settings updated successfully',
    });
    return;
  })
);

export const generalSettingsRoutes = router;
