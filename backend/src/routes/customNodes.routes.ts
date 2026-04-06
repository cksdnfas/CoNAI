import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ModuleDefinitionModel } from '../models/ModuleDefinition';
import { CustomNodeRegistryService } from '../services/customNodeRegistryService';
import { runCustomJsModuleOnce } from '../services/graph-workflow-executor/execute-custom-js';
import { parseModuleDefinition } from '../services/graph-workflow-executor/shared';

const router = Router();

/** List local custom node folders and their current manifest load status. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const result = await CustomNodeRegistryService.scanCustomNodesFromFileSystem();
  res.json({
    success: true,
    data: result,
  });
}));

/** Rescan `user/custom_nodes` and sync valid file-backed nodes into module_definitions. */
router.post('/rescan', asyncHandler(async (_req: Request, res: Response) => {
  const result = await CustomNodeRegistryService.syncCustomNodesFromFileSystem();
  res.json({
    success: true,
    data: result,
  });
}));

/** Scaffold one starter custom node folder under `user/custom_nodes`. */
router.post('/scaffold', asyncHandler(async (req: Request, res: Response) => {
  const { folderName, key, name, description, category, color, template } = req.body ?? {};

  if (!folderName || !key || !name) {
    return res.status(400).json({
      success: false,
      error: 'folderName, key, and name are required',
    });
  }

  const result = await CustomNodeRegistryService.scaffoldCustomNode({
    folderName,
    key,
    name,
    description,
    category,
    color,
    template,
  });

  return res.status(201).json({
    success: true,
    data: result,
  });
}));

/** Run one file-backed custom node directly with ad-hoc inputs for local development feedback. */
router.post('/:key/test', asyncHandler(async (req: Request, res: Response) => {
  const key = String(req.params.key ?? '').trim();
  if (!key) {
    return res.status(400).json({
      success: false,
      error: 'Custom node key is required',
    });
  }

  await CustomNodeRegistryService.syncCustomNodesFromFileSystem();
  const moduleRecord = ModuleDefinitionModel.findByExternalKey(key);
  if (!moduleRecord || moduleRecord.authoring_source !== 'custom_node_fs') {
    return res.status(404).json({
      success: false,
      error: `Custom node not found: ${key}`,
    });
  }

  if (moduleRecord.engine_type !== 'custom_js') {
    return res.status(400).json({
      success: false,
      error: `Custom node test is only supported for custom_js modules: ${key}`,
    });
  }

  const parsedModule = parseModuleDefinition(moduleRecord);
  const inputs = req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body.inputs && typeof req.body.inputs === 'object' && !Array.isArray(req.body.inputs)
    ? req.body.inputs as Record<string, unknown>
    : {};

  const { executionResult, entry, folderPath } = await runCustomJsModuleOnce({
    moduleDefinition: parsedModule,
    resolvedInputs: inputs,
    node: {
      id: '__custom-node-test__',
      moduleId: parsedModule.id,
      moduleName: parsedModule.name,
    },
    workflow: {
      id: 0,
      name: 'Custom Node Test',
      executionId: 0,
    },
  });

  return res.json({
    success: true,
    data: {
      key,
      name: parsedModule.name,
      entry,
      folderPath,
      outputs: executionResult.outputs,
      metadata: executionResult.metadata ?? null,
      logs: executionResult.logs,
    },
  });
}));

export const customNodeRoutes = router;
export default router;
