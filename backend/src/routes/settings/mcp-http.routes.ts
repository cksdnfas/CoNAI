import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin } from '../../middleware/authMiddleware';
import { MCP_HTTP_SCOPES, mcpHttpSettingsService } from '../../services/mcpHttpSettingsService';
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

router.post('/mcp-http/keys', asyncHandler(async (req: Request, res: Response) => {
  if (typeof req.body?.name !== 'string') {
    sendRouteBadRequest(res, 'name is required');
    return;
  }
  res.status(201).json({ success: true, data: mcpHttpSettingsService.createApiKey(req.body.name, req.body.scopes) });
}));

router.put('/mcp-http/keys/:keyId', asyncHandler(async (req: Request, res: Response) => {
  if (typeof req.body?.name !== 'string' || !Array.isArray(req.body?.scopes)
      || req.body.scopes.some((scope: unknown) => !MCP_HTTP_SCOPES.includes(scope as never))) {
    sendRouteBadRequest(res, 'name and valid scopes are required');
    return;
  }
  const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
  res.json({ success: true, data: mcpHttpSettingsService.updateApiKey(keyId, req.body.name, req.body.scopes) });
}));

router.post('/mcp-http/keys/:keyId/rotate', asyncHandler(async (req: Request, res: Response) => {
  const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
  res.json({ success: true, data: mcpHttpSettingsService.rotateApiKey(keyId) });
}));

router.delete('/mcp-http/keys/:keyId', asyncHandler(async (req: Request, res: Response) => {
  const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
  res.json({ success: true, data: mcpHttpSettingsService.revokeApiKey(keyId) });
}));

export const mcpHttpSettingsRoutes = router;
