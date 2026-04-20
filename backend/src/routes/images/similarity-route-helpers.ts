import type { Request, Response } from 'express';
import { errorResponse } from '@conai/shared';
import { db } from '../../database/init';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import type { DuplicateGroup, SimilarImage } from '../../types/similarity';
import {
  parseIntegerWithFallback as parseIntegerWithFallbackInternal,
  parseNumberWithFallback as parseNumberWithFallbackInternal,
  sendRouteBadRequest,
} from '../routeValidation';
import { routeParam } from '../routeParam';
import { enrichImageWithFileView } from './utils';

export type SimilarityImageIdentifier =
  | { isHash: true; value: string }
  | { isHash: false; value: number };

type RequiredSimilarityField = 'perceptual_hash' | 'color_histogram';

type EnrichedSimilarityMatch = Omit<SimilarImage, 'image'> & {
  image: ReturnType<typeof enrichImageWithFileView>;
};

type EnrichedDuplicateGroup = Omit<DuplicateGroup, 'images'> & {
  images: Array<ReturnType<typeof enrichImageWithFileView>>;
};

export const parseIntegerWithFallback = parseIntegerWithFallbackInternal;
export const parseNumberWithFallback = parseNumberWithFallbackInternal;

const legacyImageFieldQueries: Record<RequiredSimilarityField, string> = {
  perceptual_hash: 'SELECT perceptual_hash FROM images WHERE id = ?',
  color_histogram: 'SELECT color_histogram FROM images WHERE id = ?',
};

/** Parse the shared image route param into either composite hash or legacy numeric image ID. */
export function parseImageIdentifier(id: string): SimilarityImageIdentifier {
  const numericId = parseInt(id, 10);

  if (!Number.isNaN(numericId) && id === numericId.toString()) {
    return { isHash: false, value: numericId };
  }

  return { isHash: true, value: id };
}

/** Read the shared :id route param with the existing routeParam normalization. */
export function getSimilarityRouteIdentifier(req: Request): SimilarityImageIdentifier {
  return parseImageIdentifier(routeParam(routeParam(req.params.id)));
}

/** Validate that the identified image exists and has the required similarity field before model calls. */
export function ensureImageFieldOrBlock(
  res: Response,
  identifier: SimilarityImageIdentifier,
  options: {
    field: RequiredSimilarityField;
    missingFieldMessage: string;
    hashNotFoundMessage?: string;
    legacyNotFoundMessage?: string;
  },
): boolean {
  if (identifier.isHash) {
    const image = MediaMetadataModel.findByHash(identifier.value);

    if (!image) {
      res.status(404).json(errorResponse(options.hashNotFoundMessage ?? 'Image metadata not found'));
      return false;
    }

    if (!image[options.field]) {
      sendRouteBadRequest(res, options.missingFieldMessage);
      return false;
    }

    return true;
  }

  const legacyImage = db.prepare(legacyImageFieldQueries[options.field]).get(identifier.value) as Record<RequiredSimilarityField, string | null> | undefined;

  if (!legacyImage) {
    res.status(404).json(errorResponse(options.legacyNotFoundMessage ?? 'Image not found'));
    return false;
  }

  if (!legacyImage[options.field]) {
    sendRouteBadRequest(res, options.missingFieldMessage);
    return false;
  }

  return true;
}

/** Add the shared file-view enrichment to similarity match payloads. */
export function enrichSimilarityMatches(matches: SimilarImage[]): EnrichedSimilarityMatch[] {
  return matches.map((item) => ({
    ...item,
    image: enrichImageWithFileView(item.image),
  }));
}

/** Add the shared file-view enrichment to duplicate-group image payloads. */
export function enrichDuplicateGroups(groups: DuplicateGroup[]): EnrichedDuplicateGroup[] {
  return groups.map((group) => ({
    ...group,
    images: group.images.map((image) => enrichImageWithFileView(image)),
  }));
}

/** Map similarity-route errors to the existing status-code behavior. */
export function getSimilarityErrorStatusCode(error: unknown): number {
  const errorMessage = error instanceof Error ? error.message : '';

  if (errorMessage.includes('hidden by the current safety policy')) {
    return 403;
  }

  if (errorMessage.includes('Invalid')) {
    return 400;
  }

  return 500;
}
