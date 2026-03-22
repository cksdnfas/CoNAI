import { Router } from 'express';
import { queryListRoutes } from './query-list.routes';
import { queryFileRoutes } from './query-file.routes';

const router = Router();

router.use('/', queryListRoutes);
router.use('/', queryFileRoutes);

export { router as queryRoutes };
