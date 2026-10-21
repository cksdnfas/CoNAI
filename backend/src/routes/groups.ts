import { Router } from 'express';
import { allowImagesView } from '../middleware/imageAccess';
import { requirePermission } from '../middleware/authMiddleware';
import { groupEmoticonRoutes } from './groups.emoticon.routes';
import { groupHierarchyRoutes } from './groups.hierarchy.routes';
import { groupMutationRoutes } from './groups.mutation.routes';
import { groupReadRoutes } from './groups.read.routes';
import { groupResourceRoutes } from './groups.resources.routes';

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
    const deletesGroups = (req.method === 'DELETE' && /^\/[^/]+$/.test(req.path)) || (req.method === 'POST' && req.path === '/bulk-delete');
    const mergesGroups = req.method === 'POST' && (req.path === '/bulk-move' || /^\/[^/]+\/move$/.test(req.path)) && req.body?.preview !== true && Boolean(req.body?.merge_token);
    if (mergesGroups) {
      requirePermission('images.edit')(req, res, () => requirePermission('images.delete')(req, res, next));
      return;
    }
    const permission = deletesGroups ? 'images.delete' : 'images.edit';
    requirePermission(permission)(req, res, next);
  }
});

router.use('/', groupHierarchyRoutes);
router.use('/', groupResourceRoutes);
router.use('/', groupEmoticonRoutes);
router.use('/', groupMutationRoutes);
router.use('/', groupReadRoutes);

export { router as groupRoutes };
