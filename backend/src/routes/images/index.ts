import { Router, Request, Response, NextFunction } from 'express';
import { uploadRoutes } from './upload.routes';
import { queryRoutes } from './query.routes';
import { taggingRoutes } from './tagging.routes';
import { managementRoutes } from './management.routes';
import { similarityRoutes } from './similarity.routes';
import complexSearchRoutes from './complex-search.routes';

const router = Router();

// Debug middleware - log all requests to /api/images
router.use((req: Request, res: Response, next: NextFunction) => {
  console.log('[ImageRoutes] Incoming request:', req.method, req.path);
  next();
});

// Upload routes
router.use('/', uploadRoutes);

// Tagging routes (must come before queryRoutes to avoid /:id catching /untagged-count)
router.use('/', taggingRoutes);

// Query and download routes
router.use('/', queryRoutes);

// Complex search routes (PoE-style AND/OR/NOT filtering)
router.use('/search/complex', complexSearchRoutes);

// Management routes (delete, update, etc.)
router.use('/', managementRoutes);

// Similarity search routes
router.use('/', similarityRoutes);

export { router as imageRoutes };
