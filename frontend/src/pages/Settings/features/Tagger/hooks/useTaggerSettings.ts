import { useState, useEffect } from 'react';
import type { TaggerSettings as TaggerSettingsType } from '../../../../../services/settingsApi';

interface UseTaggerSettingsProps {
  settings: TaggerSettingsType;
  onUpdate: (settings: Partial<TaggerSettingsType>) => Promise<void>;
}

export const useTaggerSettings = ({ settings, onUpdate }: UseTaggerSettingsProps) => {
  const [localSettings, setLocalSettings] = useState<TaggerSettingsType>(settings);
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    const changed = JSON.stringify(localSettings) !== JSON.stringify(settings);
    setHasChanges(changed);
  }, [localSettings, settings]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(localSettings);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  const updateSettings = (updates: Partial<TaggerSettingsType>) => {
    setLocalSettings({ ...localSettings, ...updates });
  };

  return {
    localSettings,
    loading,
    hasChanges,
    updateSettings,
    handleSave,
    handleReset,
  };
};
