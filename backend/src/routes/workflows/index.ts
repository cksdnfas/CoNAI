import { Router } from 'express';
import crudRoutes from './crud.routes';
import executionRoutes from './execution.routes';
import serversRoutes from './servers.routes';

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
 *   GET    /api/workflows/:id/test-connection
 *   GET    /api/workflows/canvas-images
 *
 * Server Management:
 *   GET    /api/workflows/:id/servers
 *   POST   /api/workflows/:id/servers
 *   DELETE /api/workflows/:id/servers/:serverId
 */

// Mount CRUD routes
router.use('/', crudRoutes);

// Mount execution routes
router.use('/', executionRoutes);

// Mount server management routes
router.use('/', serversRoutes);

export { router as workflowRoutes };
