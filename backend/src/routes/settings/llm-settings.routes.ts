import { Router, Request, Response } from 'express';
import type { LlmSettings } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import { nativeSettingsRevision } from '../../services/nativeEditRevision';
import { sendRouteBadRequest } from '../routeValidation';
import { normalizeLlmPresetCollectionPayload } from './llmPresetPayload';

const router = Router();
const collectionKeys = ['systemPromptPresets', 'promptPresets', 'structuredOutputJsonPresets'] as const;

router.get(
  '/llm-presets/options',
  asyncHandler(async (_req: Request, res: Response) => {
    const collections = settingsService.getLlmPresetOptions();
    res.json({
      success: true,
      data: {
        ...collections,
        collectionRevisions: Object.fromEntries(collectionKeys.map((key) => [key, nativeSettingsRevision(collections[key])])),
      },
    });
    return;
  })
);

router.put(
  '/llm',
  asyncHandler(async (req: Request, res: Response) => {
    const llmSettings = req.body as Partial<LlmSettings>;
    const current = settingsService.loadSettings().llm;

    try {
      if (llmSettings.systemPromptPresets !== undefined) {
        llmSettings.systemPromptPresets = normalizeLlmPresetCollectionPayload(llmSettings.systemPromptPresets, {
          collectionKey: 'systemPromptPresets',
          label: '시스템 프롬프트 프리셋',
          current: current.systemPromptPresets,
        });
      }

      if (llmSettings.promptPresets !== undefined) {
        llmSettings.promptPresets = normalizeLlmPresetCollectionPayload(llmSettings.promptPresets, {
          collectionKey: 'promptPresets',
          label: '프롬프트 프리셋',
          current: current.promptPresets,
        });
      }

      if (llmSettings.structuredOutputJsonPresets !== undefined) {
        llmSettings.structuredOutputJsonPresets = normalizeLlmPresetCollectionPayload(llmSettings.structuredOutputJsonPresets, {
          collectionKey: 'structuredOutputJsonPresets',
          label: '구조화 출력 JSON 프리셋',
          valueType: 'json',
          current: current.structuredOutputJsonPresets,
        });
      }
    } catch (error) {
      sendRouteBadRequest(res, error instanceof Error ? error.message : 'LLM 프리셋을 확인해줘.');
      return;
    }

    const revision = req.get('If-Match');
    if (revision) {
      const changedCollections = collectionKeys.filter((key) => llmSettings[key] !== undefined);
      if (changedCollections.length !== 1) {
        sendRouteBadRequest(res, '리비전 검사에는 프리셋 종류 하나가 필요해.');
        return;
      }
      if (revision !== nativeSettingsRevision(current[changedCollections[0]])) {
        res.status(409).json({ success: false, error: '다른 곳에서 프리셋이 바뀌었어. 최신 목록을 확인해줘.' });
        return;
      }
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
