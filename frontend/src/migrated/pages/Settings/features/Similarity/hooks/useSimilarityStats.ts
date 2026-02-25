import { useState, useEffect } from 'react';
import { similarityApi, type SimilarityStats } from '../../../../../services/similarityApi';
import { settingsApi } from '../../../../../services/settingsApi';

export const useSimilarityStats = () => {
  const [stats, setStats] = useState<SimilarityStats | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState(0);
  const [rebuildProcessed, setRebuildProcessed] = useState(0);
  const [rebuildTotal, setRebuildTotal] = useState(0);
  const [autoGenerateHash, setAutoGenerateHash] = useState(true);

  useEffect(() => {
    loadStats();
    loadSettings();
  }, []);

  const loadStats = async () => {
    try {
      const loadedStats = await similarityApi.getStats();
      setStats(loadedStats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const loadedSettings = await settingsApi.getSettings();
      setAutoGenerateHash(loadedSettings.similarity.autoGenerateHashOnUpload);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleAutoGenerateHashChange = async (newValue: boolean, t: any) => {
    setAutoGenerateHash(newValue);

    try {
      await settingsApi.updateSimilaritySettings({ autoGenerateHashOnUpload: newValue });
    } catch (error) {
      console.error('Failed to update similarity settings:', error);
      alert(t('similarity.systemStatus.autoGenerateUpdateFailed'));
      setAutoGenerateHash(!newValue);
    }
  };

  const handleRebuildHashes = async (t: any) => {
    setRebuilding(true);
    setRebuildProgress(0);
    setRebuildProcessed(0);
    setRebuildTotal(0);

    try {
      const initialStats = await similarityApi.getStats();
      const totalToProcess = initialStats.imagesWithoutHash;
      setRebuildTotal(totalToProcess);

      if (totalToProcess === 0) {
        alert(t('similarity.systemStatus.noImagesToProcess'));
        return;
      }

      let totalProcessed = 0;
      let totalFailed = 0;
      const batchSize = 50;

      while (totalProcessed < totalToProcess) {
        const result = await similarityApi.rebuildHashes(batchSize);

        totalProcessed += result.processed;
        totalFailed += result.failed;

        setRebuildProcessed(totalProcessed);
        setRebuildProgress((totalProcessed / totalToProcess) * 100);

        if (result.remaining === 0) {
          break;
        }
      }

      if (totalFailed > 0) {
        alert(t('similarity.systemStatus.rebuildCompleteWithErrors', { success: totalProcessed, failed: totalFailed }));
      } else {
        alert(t('similarity.systemStatus.rebuildComplete', { processed: totalProcessed }));
      }

      await loadStats();
    } catch (error) {
      alert(t('similarity.systemStatus.rebuildFailed'));
      console.error('Failed to rebuild hashes:', error);
    } finally {
      setRebuilding(false);
    }
  };

  return {
    stats,
    rebuilding,
    rebuildProgress,
    rebuildProcessed,
    rebuildTotal,
    autoGenerateHash,
    loadStats,
    handleAutoGenerateHashChange,
    handleRebuildHashes,
  };
};
