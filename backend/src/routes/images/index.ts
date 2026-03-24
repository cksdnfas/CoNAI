import { Router, Request, Response, NextFunction } from 'express';
import { uploadRoutes } from './upload.routes';
import { queryRoutes } from './query.routes';
import { taggingRoutes } from './tagging.routes';
import { managementRoutes } from './management.routes';
import { similarityRoutes } from './similarity.routes';
import complexSearchRoutes from './complex-search.routes';
import metadataRoutes from './metadata.routes';
import hashRoutes from './hash.routes';
import promptSimilarityRoutes from './prompt-similarity.routes';
import { logger } from '../../utils/logger';

const router = Router();

// Debug middleware - log all requests to /api/images
router.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug('[ImageRoutes] Incoming request:', req.method, req.path);
  next();
});

// Upload routes
router.use('/', uploadRoutes);

// Tagging routes (must come before queryRoutes to avoid /:id catching /untagged-count)
router.use('/', taggingRoutes);

// Metadata routes (composite_hash 기반 메타데이터 조회)
router.use('/metadata', metadataRoutes);

// Hash generation routes (안전장치: 해시 생성)
router.use('/', hashRoutes);

// Prompt similarity routes
router.use('/prompt-similarity', promptSimilarityRoutes);

// Query and download routes
router.use('/', queryRoutes);

// Complex search routes (PoE-style AND/OR/NOT filtering)
router.use('/search/complex', complexSearchRoutes);

// Similarity search routes (must come before managementRoutes to avoid /:compositeHash catching /files/bulk)
router.use('/', similarityRoutes);

// Management routes (delete, update, etc.)
router.use('/', managementRoutes);

export { router as imageRoutes };
