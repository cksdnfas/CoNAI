import { Router } from 'express';
import { allowImagesView } from '../middleware/imageAccess';
import { requirePermission } from '../middleware/authMiddleware';
import { groupEmoticonRoutes } from './groups.emoticon.routes';
import { groupHierarchyRoutes } from './groups.hierarchy.routes';
import { groupMutationRoutes } from './groups.mutation.routes';
import { groupReadRoutes } from './groups.read.routes';

const router = Router();
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/resolve-path') {
    if (req.body?.create === true) requirePermission('images.edit')(req, res, next);
    else allowImagesView(req, res, next);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    allowImagesView(req, res, next);
  } else {
    const permission = req.method === 'DELETE' && /^\/[^/]+$/.test(req.path) ? 'images.delete' : 'images.edit';
    requirePermission(permission)(req, res, next);
  }
});

router.use('/', groupHierarchyRoutes);
router.use('/', groupEmoticonRoutes);
router.use('/', groupMutationRoutes);
router.use('/', groupReadRoutes);

export { router as groupRoutes };
