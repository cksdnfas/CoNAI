import { useState, useEffect } from 'react';
import { taggerBatchApi } from '../../../../../services/settingsApi';

export const useTaggerBatch = () => {
  const [batchProcessing, setBatchProcessing] = useState(false);

  const handleResetAutoTags = async (t: any) => {
    if (!window.confirm(t('tagger.batch.confirmDialog.resetMessage', 'Are you sure you want to reset ALL auto tags? This will clear active tags and queue images for background processing.'))) {
      return;
    }

    setBatchProcessing(true);
    try {
      const result = await taggerBatchApi.resetAutoTags();
      alert(t('tagger.batch.alerts.resetComplete', {
        defaultValue: 'Reset complete. Queued for background processing.',
        changes: result.changes
      }));
    } catch (error) {
      alert(t('tagger.batch.alerts.resetFailed', 'Failed to reset tags'));
      console.error('Failed to reset auto tags:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  return {
    batchProcessing,
    handleResetAutoTags,
  };
};
