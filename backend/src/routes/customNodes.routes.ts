import { spawn } from 'child_process';
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ModuleDefinitionModel } from '../models/ModuleDefinition';
import { CustomNodeRegistryService } from '../services/customNodeRegistryService';
import { runCustomJsModuleOnce } from '../services/graph-workflow-executor/execute-custom-js';
import { parseModuleDefinition } from '../services/graph-workflow-executor/shared';

const router = Router();

/** Open one local folder path in the host operating system file explorer. */
function openFolderInHostExplorer(folderPath: string) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [folderPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  const child = spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

/** Run one npm install inside a custom node folder and capture the command output. */
async function runCustomNodeNpmInstall(folderPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCommand, ['install'], {
      cwd: folderPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

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

/** Return source paths and manifest details for one valid local custom node package. */
router.get('/:key/source', asyncHandler(async (req: Request, res: Response) => {
  const key = String(req.params.key ?? '').trim();
  if (!key) {
    return res.status(400).json({
      success: false,
      error: 'Custom node key is required',
    });
  }

  const customNodeRecord = await CustomNodeRegistryService.findCustomNodeRecordByKey(key);
  if (!customNodeRecord) {
    return res.status(404).json({
      success: false,
      error: `Custom node source not found: ${key}`,
    });
  }

  return res.json({
    success: true,
    data: {
      key,
      folderName: customNodeRecord.folderName,
      folderPath: customNodeRecord.folderPath,
      manifestPath: customNodeRecord.manifestPath,
      entryPath: customNodeRecord.entryPath,
      packageJsonPath: customNodeRecord.packageJsonPath,
      readmePath: customNodeRecord.readmePath,
      sourceHash: customNodeRecord.sourceHash,
      manifest: customNodeRecord.manifest,
    },
  });
}));

/** Run npm install inside one valid custom node folder when the package.json file exists. */
router.post('/:key/install', asyncHandler(async (req: Request, res: Response) => {
  const key = String(req.params.key ?? '').trim();
  if (!key) {
    return res.status(400).json({
      success: false,
      error: 'Custom node key is required',
    });
  }

  const customNodeRecord = await CustomNodeRegistryService.findCustomNodeRecordByKey(key);
  if (!customNodeRecord) {
    return res.status(404).json({
      success: false,
      error: `Custom node package not found: ${key}`,
    });
  }

  if (!customNodeRecord.packageJsonPath) {
    return res.status(400).json({
      success: false,
      error: `No package.json found for custom node: ${key}`,
    });
  }

  const installResult = await runCustomNodeNpmInstall(customNodeRecord.folderPath);
  const success = installResult.code === 0;

  return res.status(success ? 200 : 500).json({
    success,
    data: success ? {
      key,
      folderPath: customNodeRecord.folderPath,
      packageJsonPath: customNodeRecord.packageJsonPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
    } : undefined,
    error: success ? undefined : `npm install failed for custom node: ${key}`,
    details: success ? undefined : {
      key,
      folderPath: customNodeRecord.folderPath,
      packageJsonPath: customNodeRecord.packageJsonPath,
      stdout: installResult.stdout,
      stderr: installResult.stderr,
    },
  });
}));

/** Open one valid local custom node folder in the host OS file explorer. */
router.post('/:key/open-folder', asyncHandler(async (req: Request, res: Response) => {
  const key = String(req.params.key ?? '').trim();
  if (!key) {
    return res.status(400).json({
      success: false,
      error: 'Custom node key is required',
    });
  }

  const customNodeRecord = await CustomNodeRegistryService.findCustomNodeRecordByKey(key);
  if (!customNodeRecord) {
    return res.status(404).json({
      success: false,
      error: `Custom node folder not found: ${key}`,
    });
  }

  openFolderInHostExplorer(customNodeRecord.folderPath);
  return res.json({
    success: true,
    data: {
      key,
      folderPath: customNodeRecord.folderPath,
    },
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
