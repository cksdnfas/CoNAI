import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { CustomNodeRegistryService } from '../services/customNodeRegistryService';

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

export const customNodeRoutes = router;
export default router;
