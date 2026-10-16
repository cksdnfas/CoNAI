import { Router } from 'express';
import { isGenerationLayoutSurface } from '@conai/shared';
import { requireAdmin, requirePermission } from '../middleware/authMiddleware';
import { readGenerationLayouts, writeGenerationLayouts } from '../services/generationLayouts';

const router = Router();

router.get('/', requirePermission('page.generation.view'), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: readGenerationLayouts() });
});

router.put('/:surface', requireAdmin, (req, res) => {
  const surface = req.params.surface;
  if (!isGenerationLayoutSurface(surface)) { res.status(404).json({ success: false, error: '모르는 레이아웃 화면이야.' }); return; }
  const revision = req.get('If-Match');
  if (!revision) { res.status(428).json({ success: false, error: '최신 레이아웃을 먼저 읽어줘.' }); return; }
  const presets = (req.body as { presets?: unknown } | undefined)?.presets;
  if (!Array.isArray(presets) || presets.length === 0) { res.status(400).json({ success: false, error: '프리셋이 하나 이상 있어야 해.' }); return; }
  const result = writeGenerationLayouts(surface, presets, revision);
  if (result === 'conflict') { res.status(409).json({ success: false, error: '다른 곳에서 레이아웃이 바뀌었어. 다시 열어서 편집해줘.' }); return; }
  res.json({ success: true, data: result });
});

export const generationLayoutRoutes = router;
