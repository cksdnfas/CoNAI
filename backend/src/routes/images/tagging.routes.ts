import { Router } from 'express';
import { taggingMutationRoutes } from './tagging.mutation.routes';
import { taggingQueryRoutes } from './tagging.query.routes';

const router = Router();

router.use('/', taggingQueryRoutes);
router.use('/', taggingMutationRoutes);

export { router as taggingRoutes };
