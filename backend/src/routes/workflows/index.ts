import { Router } from 'express';
import crudRoutes from './crud.routes';
import executionRoutes from './execution.routes';
import artifactsRoutes from './artifacts.routes';
import serversRoutes from './servers.routes';
import { requireImagesView } from '../../middleware/imageAccess';
import { requireAdmin } from '../../middleware/authMiddleware';

const router = Router();

/**
 * Workflow Routes Integration
 *
 * All routes are mounted at /api/workflows
 *
 * CRUD Operations:
 *   GET    /api/workflows
 *   GET    /api/workflows/:id
 *   POST   /api/workflows
 *   PUT    /api/workflows/:id
 *   DELETE /api/workflows/:id
 *
 * Execution & History:
 *   POST   /api/workflows/:id/generate
 *   GET    /api/workflows/:id/history
 *   GET    /api/workflows/history/:historyId
 *   GET    /api/workflows/canvas-images
 *
 * Server Management:
 *   GET    /api/workflows/:id/servers
 *   POST   /api/workflows/:id/servers
 *   DELETE /api/workflows/:id/servers/:serverId
 */

// Static execution paths must precede the CRUD `/:id` route.
// The legacy response includes the server's absolute canvas directory.
router.use('/canvas-images', requireAdmin, requireImagesView);
router.use('/', executionRoutes);

// Mount CRUD routes
router.use('/', crudRoutes);

// Mount artifact browsing routes
router.use('/', artifactsRoutes);

// Mount server management routes
router.use('/', serversRoutes);

export { router as workflowRoutes };
