import type { Request, Response } from 'express';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { GenerationHistoryService } from '../../services/generationHistoryService';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { getActiveFileOrBlock, type ImageDownloadType } from '../images/query-file-helpers';
import { getRequesterAccountId, isAdminRequest } from '../requester-session-helpers';
import { parsePositiveInteger } from '../routeValidation';

export function parseOptionalPositiveIntegerQuery(value: unknown): number | undefined {
  const parsed = parsePositiveInteger(value);
  if (parsed !== null) {
    return parsed;
  }

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  throw new Error('positive-integer');
}

export function applyHistoryAccessScope(req: Request, filters: Record<string, any>, mineOnly: boolean) {
  const requesterAccountId = getRequesterAccountId(req);

  if (!isAdminRequest(req)) {
    if (requesterAccountId === null) {
      return { forceEmpty: true } as const;
    }

    filters.requested_by_account_id = requesterAccountId;
    if (req.session?.accountType === 'guest') {
      filters.requested_by_account_type = 'guest';
    }

    return { forceEmpty: false } as const;
  }

  if (mineOnly) {
    if (requesterAccountId === null) {
      return { forceEmpty: true } as const;
    }

    filters.requested_by_account_id = requesterAccountId;
    filters.requested_by_account_type = 'admin';
  }

  return { forceEmpty: false } as const;
}

export function buildHistoryQueryFilters(query: Request['query'], options: { includeServiceType?: boolean } = {}) {
  const {
    service_type,
    generation_status,
    requested_by_account_id,
    requested_by_account_type,
    server_id,
    queue_job_id,
    limit = '50',
    offset = '0',
  } = query;

  const filters: any = {
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
  };

  if (options.includeServiceType && service_type && (service_type === 'comfyui' || service_type === 'novelai' || service_type === 'codex')) {
    filters.service_type = service_type;
  }

  if (generation_status) {
    filters.generation_status = generation_status;
  }

  try {
    const requestedByAccountId = parseOptionalPositiveIntegerQuery(requested_by_account_id);
    const serverId = parseOptionalPositiveIntegerQuery(server_id);
    const queueJobId = parseOptionalPositiveIntegerQuery(queue_job_id);

    if (requestedByAccountId !== undefined) {
      filters.requested_by_account_id = requestedByAccountId;
    }

    if (serverId !== undefined) {
      filters.server_id = serverId;
    }

    if (queueJobId !== undefined) {
      filters.queue_job_id = queueJobId;
    }
  } catch {
    return {
      filters,
      error: 'requested_by_account_id, server_id, and queue_job_id must be positive integers',
    } as const;
  }

  if (requested_by_account_type !== undefined) {
    if (requested_by_account_type !== 'admin' && requested_by_account_type !== 'guest') {
      return {
        filters,
        error: 'requested_by_account_type must be either admin or guest',
      } as const;
    }

    filters.requested_by_account_type = requested_by_account_type;
  }

  return { filters, error: null } as const;
}

export function parseImageDownloadType(value: unknown): ImageDownloadType {
  return value === 'thumbnail' ? 'thumbnail' : 'original';
}

export function canAccessHistoryRecord(
  req: Request,
  record: { requested_by_account_id?: number | null; requested_by_account_type?: string | null },
) {
  if (isAdminRequest(req)) {
    return true;
  }

  const requesterAccountId = getRequesterAccountId(req);
  const requesterAccountType = req.session?.accountType;
  return requesterAccountId !== null
    && record.requested_by_account_id === requesterAccountId
    && record.requested_by_account_type === requesterAccountType;
}

export function getHistoryCompositeHash(record: { actual_composite_hash?: string | null }) {
  return record.actual_composite_hash || null;
}

export async function getAccessibleHistoryMediaOrBlock(req: Request, res: Response, idValue: string) {
  const historyId = parseInt(idValue, 10);
  if (!Number.isInteger(historyId) || historyId <= 0) {
    res.status(400).json({ success: false, error: 'Invalid generation history id' });
    return null;
  }

  const record = await GenerationHistoryService.getHistoryDetail(historyId);
  if (!record) {
    res.status(404).json({ success: false, error: 'Generation history not found' });
    return null;
  }

  if (!canAccessHistoryRecord(req, record)) {
    res.status(403).json({ success: false, error: 'Not allowed to access this generation history item' });
    return null;
  }

  const compositeHash = getHistoryCompositeHash(record);
  if (!compositeHash) {
    res.status(404).json({ success: false, error: 'Generation history image not found' });
    return null;
  }

  const metadata = await MediaMetadataModel.findByHash(compositeHash);
  if (!metadata) {
    res.status(404).json({ success: false, error: 'Metadata not found' });
    return null;
  }

  if (!MediaPostprocessVisibilityService.isReadyRecord(metadata)) {
    res.status(404).json({ success: false, error: 'Generation history image not found' });
    return null;
  }

  const file = await getActiveFileOrBlock(res, compositeHash, 'Image file not found');
  if (!file) {
    return null;
  }

  return { record, compositeHash, metadata, file };
}

export function buildMissingHistoryFileWarning(filePath: string) {
  return `[GenerationHistoryServe] File missing on disk during raw file access: ${resolveUploadsPath(filePath)}`;
}
