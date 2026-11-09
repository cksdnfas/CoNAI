import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { allowAnonymousAnyPermission, requirePermission } from '../middleware/authMiddleware';
import { requireImagesView } from '../middleware/imageAccess';
import { orPublicWorkflow } from '../middleware/publicWorkflowScope';
import { listRefModRecords, resolveRefModRecordMedia, deleteRefModRecord } from '../services/comfyui/refmodRecords';
import { ComfyInputValidationError } from '../services/prepareComfyPromptData';
import { streamCacheableFile, streamRangeFile } from './images/query-file-response-helpers';
import { getVisibleMetadataOrBlock } from './images/query-file-helpers';
import { parsePositiveIntegerQuery, sendRouteBadRequest } from './routeValidation';
import { routeParam } from './routeParam';

const router = Router();

router.get('/', orPublicWorkflow(allowAnonymousAnyPermission(['generation.execute', 'workflows.view', 'images.view'])), asyncHandler(async (req, res) => {
  const serverId = parsePositiveIntegerQuery(req.query.serverId === '' ? undefined : req.query.serverId, 0, { error: 'serverId must be a positive integer' });
  if (!serverId.ok) return sendRouteBadRequest(res, serverId.error);
  return res.json({ success: true, data: listRefModRecords(serverId.value || undefined) });
}));

router.get('/:id/media/:index', requireImagesView, asyncHandler(async (req, res) => {
  const id = Number(routeParam(req.params.id));
  const index = Number(routeParam(req.params.index));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(index) || index < 0) return sendRouteBadRequest(res, 'Invalid record ID or member index');
  const media = resolveRefModRecordMedia(id, index);
  if (!media) return res.status(404).json({ success: false, error: 'RefMod source not found' });
  if (media.compositeHash && !await getVisibleMetadataOrBlock(res, media.compositeHash)) return undefined;
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (media.kind === 'video' || media.kind === 'audio') await streamRangeFile(req, res, media.filePath, media.mimeType);
    else await streamCacheableFile(req, res, media.filePath, media.mimeType);
    return undefined;
  } catch (error) {
    console.error('[RefMod media] Failed to serve retained source', error);
    return res.status((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).json({ success: false, error: 'RefMod source file is unavailable' });
  }
}));

router.delete('/:id', requirePermission('workflows.edit'), asyncHandler(async (req, res) => {
  const id = Number(routeParam(req.params.id));
  if (!Number.isSafeInteger(id) || id <= 0) return sendRouteBadRequest(res, 'Invalid record ID');
  try {
    if (!await deleteRefModRecord(id)) return res.status(404).json({ success: false, error: 'RefMod record not found' });
  } catch (error) {
    if (error instanceof ComfyInputValidationError) return res.status(409).json({ success: false, error: error.message });
    throw error;
  }
  return res.json({ success: true, message: 'CoNAI record and retained copies deleted. The RefMod bundle on the ComfyUI server and library source media were not deleted.' });
}));

export default router;
