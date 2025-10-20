import { useState, useEffect } from 'react';
import { taggerBatchApi } from '../../../../../services/settingsApi';

export const useTaggerBatch = () => {
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  useEffect(() => {
    loadUntaggedCount();
  }, []);

  const loadUntaggedCount = async () => {
    try {
      const count = await taggerBatchApi.getUntaggedCount();
      setUntaggedCount(count);
    } catch (error) {
      console.error('Failed to load untagged count:', error);
    }
  };

  const handleBatchTagUnprocessed = async (t: any) => {
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagUnprocessed(100);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(t('tagger.batch.alerts.complete', { success: result.success_count, failed: result.fail_count }));
      await loadUntaggedCount();
    } catch (error) {
      alert(t('tagger.batch.alerts.failed'));
      console.error('Failed to batch tag unprocessed:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleBatchTagAll = async (t: any) => {
    setConfirmDialog(false);
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagAll(100, true);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(t('tagger.batch.alerts.complete', { success: result.success_count, failed: result.fail_count }));
      await loadUntaggedCount();
    } catch (error) {
      alert(t('tagger.batch.alerts.tagAllFailed'));
      console.error('Failed to batch tag all:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  return {
    batchProcessing,
    batchProgress,
    batchTotal,
    untaggedCount,
    confirmDialog,
    setConfirmDialog,
    loadUntaggedCount,
    handleBatchTagUnprocessed,
    handleBatchTagAll,
  };
};
