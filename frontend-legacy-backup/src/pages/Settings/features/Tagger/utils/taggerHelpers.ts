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

/**
 * Validate composite_hash format (48-character hexadecimal for images, 32 for videos)
 * ✅ Changed from numeric validation to hex string validation
 */
export const validateCompositeHash = (value: string): { isValid: boolean; hash?: string } => {
  // Accept both 48-char (image) and 32-char (video) hashes
  const hashPattern = /^[0-9a-fA-F]{32,48}$/;

  if (!hashPattern.test(value)) {
    return { isValid: false };
  }

  return { isValid: true, hash: value };
};

/**
 * @deprecated Use validateCompositeHash instead
 * Legacy function kept for backward compatibility
 */
export const validateImageId = (value: string): { isValid: boolean; imageId?: number } => {
  // For backward compatibility, try composite_hash validation first
  const hashResult = validateCompositeHash(value);
  if (hashResult.isValid) {
    // Return as if it was a valid "ID" (actually a hash)
    return { isValid: true, imageId: 0 }; // Dummy imageId since hash is the real identifier
  }

  // Legacy numeric validation (deprecated)
  const imageId = parseInt(value);
  if (isNaN(imageId) || imageId <= 0) {
    return { isValid: false };
  }
  return { isValid: true, imageId };
};
