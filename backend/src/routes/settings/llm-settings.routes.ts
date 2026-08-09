import { Router, Request, Response } from 'express';
import type { LlmSettings } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import { sendRouteBadRequest } from '../routeValidation';
import { normalizeLlmPresetCollectionPayload } from './llmPresetPayload';

const router = Router();

router.get(
  '/llm-presets/options',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: settingsService.getLlmPresetOptions(),
    });
    return;
  })
);

router.put(
  '/llm',
  asyncHandler(async (req: Request, res: Response) => {
    const llmSettings = req.body as Partial<LlmSettings>;

    try {
      if (llmSettings.systemPromptPresets !== undefined) {
        llmSettings.systemPromptPresets = normalizeLlmPresetCollectionPayload(llmSettings.systemPromptPresets, {
          collectionKey: 'systemPromptPresets',
          label: '시스템 프롬프트 프리셋',
        });
      }

      if (llmSettings.promptPresets !== undefined) {
        llmSettings.promptPresets = normalizeLlmPresetCollectionPayload(llmSettings.promptPresets, {
          collectionKey: 'promptPresets',
          label: '프롬프트 프리셋',
        });
      }

      if (llmSettings.structuredOutputJsonPresets !== undefined) {
        llmSettings.structuredOutputJsonPresets = normalizeLlmPresetCollectionPayload(llmSettings.structuredOutputJsonPresets, {
          collectionKey: 'structuredOutputJsonPresets',
          label: '구조화 출력 JSON 프리셋',
          valueType: 'json',
        });
      }
    } catch (error) {
      sendRouteBadRequest(res, error instanceof Error ? error.message : 'LLM 프리셋을 확인해줘.');
      return;
    }

    const updatedSettings = settingsService.updateLlmSettings(llmSettings);
    res.json({
      success: true,
      data: updatedSettings,
      message: 'LLM 설정을 저장했어.',
    });
    return;
  })
);

export const llmSettingsRoutes = router;
