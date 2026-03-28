import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';

const router = Router();

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function parseLimit(value: unknown, fallback = 16, max = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

router.get('/models', asyncHandler(async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = parseLimit(req.query.limit);
    const items = MediaMetadataModel.searchModelSuggestions(query, limit);

    const response: ApiResponse<typeof items> = {
      success: true,
      data: items,
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting model search options:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get model search options',
    } satisfies ApiResponse<never>);
  }
}));

router.get('/loras', asyncHandler(async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = parseLimit(req.query.limit);
    const items = MediaMetadataModel.searchLoraSuggestions(query, limit);

    const response: ApiResponse<typeof items> = {
      success: true,
      data: items,
    };

    return res.json(response);
  } catch (error) {
    console.error('Error getting LoRA search options:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get LoRA search options',
    } satisfies ApiResponse<never>);
  }
}));

export default router;
