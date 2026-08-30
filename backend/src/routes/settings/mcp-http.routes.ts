import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin } from '../../middleware/authMiddleware';
import { mcpHttpSettingsService } from '../../services/mcpHttpSettingsService';
import { asyncHandler } from '../../middleware/asyncHandler';
import { sendRouteBadRequest } from '../routeValidation';

const router = Router();

router.use('/mcp-http', requireAdmin, (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get(
  '/mcp-http',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mcpHttpSettingsService.loadSettings(),
    });
  }),
);

router.put(
  '/mcp-http',
  asyncHandler(async (req: Request, res: Response) => {
    if (typeof req.body?.enabled !== 'boolean') {
      sendRouteBadRequest(res, 'enabled must be a boolean');
      return;
    }

    res.json({
      success: true,
      data: mcpHttpSettingsService.updateEnabled(req.body.enabled),
    });
  }),
);

router.post(
  '/mcp-http/rotate-key',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: mcpHttpSettingsService.rotateApiKey(),
    });
  }),
);

export const mcpHttpSettingsRoutes = router;
