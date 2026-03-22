import { Router } from 'express';
import { groupHierarchyRoutes } from './groups.hierarchy.routes';
import { groupMutationRoutes } from './groups.mutation.routes';
import { groupReadRoutes } from './groups.read.routes';

const router = Router();

router.use('/', groupHierarchyRoutes);
router.use('/', groupMutationRoutes);
router.use('/', groupReadRoutes);

export { router as groupRoutes };
