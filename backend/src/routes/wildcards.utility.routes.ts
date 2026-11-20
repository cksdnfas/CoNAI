import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { isLoraScanFile, replaceLoraWildcards } from '../services/loraWildcardScan';
import { WildcardService } from '../services/wildcardService';
import { requirePermission } from '../middleware/authMiddleware';

const router = Router();

router.post('/parse', requirePermission('wildcards.view'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { text, tool, count = 1, promptType } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    if (!tool || (tool !== 'general' && tool !== 'comfyui' && tool !== 'nai' && tool !== 'codex')) {
      return res.status(400).json({ success: false, error: 'Valid tool is required (general, comfyui, nai, or codex)' });
    }

    const parsedCount = Math.min(Math.max(parseInt(count) || 1, 1), 10);
    const results = WildcardService.parseMultiple(text, tool, parsedCount, promptType === 'negative' ? 'negative' : 'positive');

    return res.json({
      success: true,
      data: {
        original: text,
        results,
        usedWildcards: WildcardService.extractWildcardNames(text)
      }
    });
  } catch (error) {
    console.error('Error parsing wildcards:', error);
    return res.status(500).json({ success: false, error: 'Failed to parse wildcards' });
  }
}));

router.post('/scan-lora-folder', requirePermission('wildcards.edit'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { loraFiles, loraWeight = 1.0, duplicateHandling = 'number' } = req.body;

    if (!Array.isArray(loraFiles) || loraFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'LORA files array is required' });
    }

    if (!loraFiles.every(isLoraScanFile)) {
      return res.status(400).json({ success: false, error: 'Each LORA file needs a folder name, model name, and text lines if provided' });
    }
    if (typeof loraWeight !== 'number' || !Number.isFinite(loraWeight) || loraWeight < 0.1 || loraWeight > 2.0) {
      return res.status(400).json({ success: false, error: 'Invalid lora weight (must be between 0.1 and 2.0)' });
    }

    if (duplicateHandling !== 'number' && duplicateHandling !== 'parent') {
      return res.status(400).json({ success: false, error: 'Invalid duplicate handling method' });
    }

    return res.json({ success: true, data: replaceLoraWildcards(loraFiles, loraWeight, duplicateHandling) });
  } catch (error) {
    console.error('Error scanning LORA folder:', error);
    return res.status(500).json({
      success: false,
      error: `Failed to scan LORA folder: ${(error as Error).message}`
    });
  }
}));

export { router as wildcardUtilityRoutes };
