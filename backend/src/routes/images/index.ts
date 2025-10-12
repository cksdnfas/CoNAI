import { Router } from 'express';
import { uploadRoutes } from './upload.routes';
import { queryRoutes } from './query.routes';
import { taggingRoutes } from './tagging.routes';
import { managementRoutes } from './management.routes';

const router = Router();

// Upload routes
router.use('/', uploadRoutes);

// Query and download routes
router.use('/', queryRoutes);

// Tagging routes
router.use('/', taggingRoutes);

// Management routes (delete, update, etc.)
router.use('/', managementRoutes);

export { router as imageRoutes };
