import { Router } from 'express';
import { groupEmoticonRoutes } from './groups.emoticon.routes';
import { groupHierarchyRoutes } from './groups.hierarchy.routes';
import { groupMutationRoutes } from './groups.mutation.routes';
import { groupReadRoutes } from './groups.read.routes';

const router = Router();

router.use('/', groupHierarchyRoutes);
router.use('/', groupEmoticonRoutes);
router.use('/', groupMutationRoutes);
router.use('/', groupReadRoutes);

export { router as groupRoutes };
