import type { ImageRecord } from '../../../../../types/image';
import { buildUploadsUrl } from '../../../../../utils/backend';

export const getThumbnailUrl = (image: ImageRecord): string | null => {
  const path = image.thumbnail_url ?? image.original_file_path;
  return path ? buildUploadsUrl(path) : null;
};

export const getMatchTypeColor = (matchType: string): 'error' | 'warning' | 'info' | 'success' => {
  switch (matchType) {
    case 'exact': return 'error';
    case 'near-duplicate': return 'warning';
    case 'similar': return 'info';
    case 'color-similar': return 'success';
    default: return 'info';
  }
};

export const getMatchTypeLabel = (matchType: string, t: any): string => {
  switch (matchType) {
    case 'exact': return t('similarity.test.matchTypes.exact');
    case 'near-duplicate': return t('similarity.test.matchTypes.nearDuplicate');
    case 'similar': return t('similarity.test.matchTypes.similar');
    case 'color-similar': return t('similarity.test.matchTypes.colorSimilar');
    default: return t('similarity.test.matchTypes.similar');
  }
};
