import { Router } from 'express';
import { uploadRoutes } from './upload.routes';
import { queryRoutes } from './query.routes';
import { taggingRoutes } from './tagging.routes';
import { managementRoutes } from './management.routes';
import { similarityRoutes } from './similarity.routes';
import complexSearchRoutes from './complex-search.routes';

const router = Router();

// Upload routes
router.use('/', uploadRoutes);

// Query and download routes
router.use('/', queryRoutes);

// Complex search routes (PoE-style AND/OR/NOT filtering)
router.use('/search/complex', complexSearchRoutes);

// Tagging routes
router.use('/', taggingRoutes);

// Management routes (delete, update, etc.)
router.use('/', managementRoutes);

// Similarity search routes
router.use('/', similarityRoutes);

export { router as imageRoutes };
