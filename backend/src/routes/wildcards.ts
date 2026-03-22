import { Router } from 'express';
import { wildcardMutationRoutes } from './wildcards.mutation.routes';
import { wildcardReadRoutes } from './wildcards.read.routes';
import { wildcardUtilityRoutes } from './wildcards.utility.routes';

const router = Router();

router.use('/', wildcardUtilityRoutes);
router.use('/', wildcardMutationRoutes);
router.use('/', wildcardReadRoutes);

export default router;
