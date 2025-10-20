import { useState, useEffect } from 'react';
import { settingsApi, type TaggerModel, type TaggerServerStatus } from '../../../../../services/settingsApi';

export const useTaggerModels = (enabled: boolean) => {
  const [models, setModels] = useState<TaggerModel[]>([]);
  const [modelStatus, setModelStatus] = useState<TaggerServerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadModels();
    loadModelStatus();
  }, []);

  useEffect(() => {
    // Poll model status every 5 seconds when enabled
    if (enabled) {
      const interval = setInterval(loadModelStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [enabled]);

  const loadModels = async () => {
    try {
      const modelsList = await settingsApi.getModelsList();
      setModels(modelsList);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadModelStatus = async () => {
    try {
      setStatusLoading(true);
      const status = await settingsApi.getTaggerStatus();
      setModelStatus(status);
    } catch (error) {
      console.error('Failed to load model status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleLoadModel = async (modelName: string, t: any) => {
    setLoading(true);
    try {
      await settingsApi.loadModel(modelName as 'vit' | 'swinv2' | 'convnext');
      await loadModelStatus();
      alert(t('tagger.alerts.modelLoaded'));
    } catch (error) {
      alert(t('tagger.alerts.loadFailed'));
      console.error('Failed to load model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnloadModel = async (t: any) => {
    setLoading(true);
    try {
      await settingsApi.unloadModel();
      await loadModelStatus();
      alert(t('tagger.alerts.modelUnloaded'));
    } catch (error) {
      alert(t('tagger.alerts.unloadFailed'));
      console.error('Failed to unload model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadModel = async (modelName: string, onSuccess?: () => void) => {
    setLoading(true);
    try {
      const result = await settingsApi.downloadModel(modelName as 'vit' | 'swinv2' | 'convnext');
      alert(result.message);
      await loadModels();
      if (onSuccess) onSuccess();
    } catch (error) {
      alert('Failed to download model');
      console.error('Failed to download model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckDependencies = async () => {
    try {
      const result = await settingsApi.checkDependencies();
      return result;
    } catch (error) {
      console.error('Failed to check dependencies:', error);
      return { available: false, message: 'Failed to check dependencies' };
    }
  };

  return {
    models,
    modelStatus,
    statusLoading,
    loading,
    loadModels,
    loadModelStatus,
    handleLoadModel,
    handleUnloadModel,
    handleDownloadModel,
    handleCheckDependencies,
  };
};
