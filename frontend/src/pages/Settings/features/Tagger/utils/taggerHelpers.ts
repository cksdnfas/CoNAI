export const formatRelativeTime = (isoString: string | null, t: any): string => {
  if (!isoString) return t('tagger.modelStatus.none');
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return t('tagger.modelStatus.justNow');
  if (diffMins < 60) return t('tagger.modelStatus.minutesAgo', { minutes: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t('tagger.modelStatus.hoursAgo', { hours: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t('tagger.modelStatus.daysAgo', { days: diffDays });
};

export const validateImageId = (value: string): { isValid: boolean; imageId?: number } => {
  const imageId = parseInt(value);
  if (isNaN(imageId) || imageId <= 0) {
    return { isValid: false };
  }
  return { isValid: true, imageId };
};
