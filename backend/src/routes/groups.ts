import { Router } from 'express';
import { allowRead, requireDelete, requireEdit } from '../middleware/authMiddleware';
import { groupEmoticonRoutes } from './groups.emoticon.routes';
import { groupHierarchyRoutes } from './groups.hierarchy.routes';
import { groupMutationRoutes } from './groups.mutation.routes';
import { groupReadRoutes } from './groups.read.routes';
import { groupResourceRoutes } from './groups.resources.routes';

const router = Router();
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/resolve-path') {
    if (req.body?.create === true) requireEdit(req, res, next);
    else allowRead(req, res, next);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    allowRead(req, res, next);
  } else {
    const deletesGroups = (req.method === 'DELETE' && /^\/[^/]+$/.test(req.path)) || (req.method === 'POST' && req.path === '/bulk-delete');
    const mergesGroups = req.method === 'POST' && (req.path === '/bulk-move' || /^\/[^/]+\/move$/.test(req.path)) && req.body?.preview !== true && Boolean(req.body?.merge_token);
    if (mergesGroups) {
      requireEdit(req, res, () => requireDelete(req, res, next));
      return;
    }
    (deletesGroups ? requireDelete : requireEdit)(req, res, next);
  }
});

router.use('/', groupHierarchyRoutes);
router.use('/', groupResourceRoutes);
router.use('/', groupEmoticonRoutes);
router.use('/', groupMutationRoutes);
router.use('/', groupReadRoutes);

export { router as groupRoutes };
