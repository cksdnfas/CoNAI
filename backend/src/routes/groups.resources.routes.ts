import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requirePermission } from '../middleware/authMiddleware';
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers';
import { listGroupResources } from '../services/groupResources';

export const groupResourceRoutes = Router();
groupResourceRoutes.get('/:id/resources', requirePermission('images.view'), asyncHandler(async (req, res) => {
  const input = z.object({ id: z.coerce.number().int().positive(), offset: z.coerce.number().int().min(0).max(1000000) }).safeParse({ id: req.params.id, offset: req.query.offset ?? 0 });
  if (!input.success) { res.status(400).json({ success: false, error: '그룹 ID와 목록 위치를 확인해줘.' }); return; }
  const { id, offset } = input.data;
  const data = await listGroupResources({ requester: { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) } }, id, offset);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data });
}));
