import { Router, Request, Response } from 'express';
import type { AiRuntimeSettings } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import { taggerDaemon } from '../../services/taggerDaemon';
import { kaloscopeTaggerService } from '../../services/kaloscopeTaggerService';
import { resetEmbeddingBackoff, textWorker } from '../../services/aiWorker/textEmbeddingService';
import {
  cancelAiRuntimeInstall,
  cleanupAiRuntimeOnBoot,
  getAiRuntimeStatus,
  onAiRuntimeSwitch,
  startAiRuntimeInstall,
} from '../../services/aiRuntime/aiRuntimeService';
import { sendRouteBadRequest, validateStringEnumIfDefined } from '../routeValidation';

const router = Router();
const validPythonSources = ['auto', 'custom'] as const;
const validBackendPreferences = ['auto', 'cpu', 'cu126', 'cu130', 'cu132'] as const;

// Workers spawned from the old environment keep its files open; stop them so the next request starts from the new one.
async function stopAiWorkers() {
  await taggerDaemon.stop();
  await kaloscopeTaggerService.stopDaemon();
  await textWorker.stop();
  resetEmbeddingBackoff();
}

onAiRuntimeSwitch(stopAiWorkers);
cleanupAiRuntimeOnBoot();

router.get(
  '/ai-runtime',
  asyncHandler(async (req: Request, res: Response) => {
    const status = await getAiRuntimeStatus({ refreshGpus: req.query.refresh === '1' });
    res.json({ success: true, data: status });
  })
);

router.put(
  '/ai-runtime',
  asyncHandler(async (req: Request, res: Response) => {
    const patch: Partial<AiRuntimeSettings> = req.body ?? {};
    if (!validateStringEnumIfDefined(res, patch.pythonSource, validPythonSources, 'Invalid pythonSource')) return;
    if (!validateStringEnumIfDefined(res, patch.torchBackend, validBackendPreferences, 'Invalid torchBackend')) return;
    if (patch.cpuThreads !== undefined && (!Number.isInteger(patch.cpuThreads) || patch.cpuThreads < 0 || patch.cpuThreads > 256)) {
      sendRouteBadRequest(res, 'cpuThreads must be an integer between 0 and 256');
      return;
    }
    if (patch.customPythonPath !== undefined && typeof patch.customPythonPath !== 'string') {
      sendRouteBadRequest(res, 'customPythonPath must be a string');
      return;
    }

    const next: Partial<AiRuntimeSettings> = {
      ...(patch.pythonSource !== undefined && { pythonSource: patch.pythonSource }),
      ...(patch.torchBackend !== undefined && { torchBackend: patch.torchBackend }),
      ...(patch.cpuThreads !== undefined && { cpuThreads: patch.cpuThreads }),
      ...(patch.customPythonPath !== undefined && { customPythonPath: patch.customPythonPath.trim() || 'python' }),
    };
    const before = settingsService.loadSettings().aiRuntime;
    settingsService.updateAiRuntimeSettings(next);
    if (before.pythonSource !== (next.pythonSource ?? before.pythonSource) || before.customPythonPath !== (next.customPythonPath ?? before.customPythonPath)) {
      // Workers pick the Python at spawn time.
      await stopAiWorkers();
    }
    res.json({ success: true, data: await getAiRuntimeStatus() });
  })
);

router.post(
  '/ai-runtime/install',
  asyncHandler(async (req: Request, res: Response) => {
    const backend = req.body?.backend;
    if (!validateStringEnumIfDefined(res, backend, validBackendPreferences, 'Invalid backend')) return;
    try {
      await startAiRuntimeInstall(backend);
    } catch (error) {
      sendRouteBadRequest(res, error instanceof Error ? error.message : String(error));
      return;
    }
    res.json({ success: true, data: await getAiRuntimeStatus() });
  })
);

router.post(
  '/ai-runtime/cancel',
  asyncHandler(async (_req: Request, res: Response) => {
    cancelAiRuntimeInstall();
    res.json({ success: true, data: await getAiRuntimeStatus() });
  })
);

export const aiRuntimeSettingsRoutes = router;
