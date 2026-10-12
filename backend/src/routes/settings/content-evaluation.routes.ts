import { Router } from 'express';
import { requireAdmin } from '../../middleware/authMiddleware';
import { contentEvaluationStatus, updateContentEvaluationSettings } from '../../services/contentEvaluation/definitionStore';

const router = Router();
router.use('/content-evaluation', requireAdmin);
router.get('/content-evaluation', (_req, res) => res.json({ success: true, data: contentEvaluationStatus() }));
router.patch('/content-evaluation', (req, res) => res.json({ success: true, data: updateContentEvaluationSettings(req.body) }));
export const contentEvaluationRoutes = router;
