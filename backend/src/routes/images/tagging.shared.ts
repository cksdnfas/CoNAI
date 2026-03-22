import { ImageTaggerService } from '../../services/imageTaggerService';
import { TaggerResult } from '../../services/taggerDaemon';
import { AutoTagsComposeService } from '../../services/autoTagsComposeService';
import { kaloscopeTaggerService } from '../../services/kaloscopeTaggerService';
import { logger } from '../../utils/logger';
import { settingsService } from '../../services/settingsService';
import { RatingData } from '../../types/autoTag';

export function extractRatingData(raw: unknown): RatingData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const rating = raw as Record<string, unknown>;
  const general = rating.general;
  const sensitive = rating.sensitive;
  const questionable = rating.questionable;
  const explicit = rating.explicit;

  if (
    typeof general !== 'number' ||
    typeof sensitive !== 'number' ||
    typeof questionable !== 'number' ||
    typeof explicit !== 'number'
  ) {
    return null;
  }

  return { general, sensitive, questionable, explicit };
}

export async function buildMergedAutoTags(
  existingAutoTags: string | null,
  taggerResult: TaggerResult,
  imagePath: string,
  mimeType?: string
): Promise<string> {
  let autoTagsJson = AutoTagsComposeService.mergeTagger(existingAutoTags, taggerResult);
  const settings = settingsService.loadSettings();

  if (settings.kaloscope.enabled && !ImageTaggerService.isVideoFile(imagePath, mimeType)) {
    const kaloscopeResult = await kaloscopeTaggerService.tagImage(imagePath);
    if (kaloscopeResult.success) {
      autoTagsJson = AutoTagsComposeService.mergeKaloscope(autoTagsJson, kaloscopeResult);
    } else {
      logger.warn('[Kaloscope] Tagging skipped or failed:', kaloscopeResult.error || kaloscopeResult.error_type || 'unknown');
    }
  }

  return autoTagsJson;
}
