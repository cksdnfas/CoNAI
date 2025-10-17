import React, { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import GeneralSettings from './components/GeneralSettings';
import TaggerSettings from './components/TaggerSettings';
import RatingScoreSettings from './components/RatingScoreSettings';
import SimilaritySettings from './components/SimilaritySettings';
import PromptList from '../PromptManagement/components/PromptList';
import { settingsApi, type AppSettings, type GeneralSettings as GeneralSettingsType, type TaggerSettings as TaggerSettingsType } from '../../services/settingsApi';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
};

const SettingsPage: React.FC = () => {
  const { t } = useTranslation('settings');
  const [tabValue, setTabValue] = useState(0);
  const [promptTabValue, setPromptTabValue] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const loadedSettings = await settingsApi.getSettings();
      setSettings(loadedSettings);
    } catch (err) {
      setError('Failed to load settings');
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGeneralSettings = async (generalSettings: Partial<GeneralSettingsType>) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const updatedSettings = await settingsApi.updateGeneralSettings(generalSettings);
      setSettings(updatedSettings);
      setSuccessMessage(t('messages.saveSuccess'));

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      setError(t('messages.saveFailed'));
      console.error('Failed to update settings:', err);
      throw err;
    }
  };

  const handleUpdateTaggerSettings = async (taggerSettings: Partial<TaggerSettingsType>) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const updatedSettings = await settingsApi.updateTaggerSettings(taggerSettings);
      setSettings(updatedSettings);
      setSuccessMessage(t('messages.saveSuccess'));

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      setError(t('messages.saveFailed'));
      console.error('Failed to update settings:', err);
      throw err;
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  if (loading) {
    return (
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error || !settings) {
    return (
      <Container maxWidth="md">
        <Box sx={{ py: 4 }}>
          <Alert severity="error">{error || 'Failed to load settings'}</Alert>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <SettingsIcon sx={{ mr: 1, fontSize: 32 }} />
            <Typography variant="h4" component="h1">
              {t('title')}
            </Typography>
          </Box>
          <Typography variant="body1" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>

        {/* Success Message */}
        {successMessage && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {successMessage}
          </Alert>
        )}

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label={t('tabs.general')} />
            <Tab label={t('tabs.tagger')} />
            <Tab label={t('tabs.rating')} />
            <Tab label={t('tabs.similarity')} />
            <Tab label={t('tabs.prompts')} />
            <Tab label={t('tabs.advanced')} disabled />
          </Tabs>
        </Box>

        {/* Tab Panels */}
        <TabPanel value={tabValue} index={0}>
          <GeneralSettings
            settings={settings.general}
            onUpdate={handleUpdateGeneralSettings}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <TaggerSettings
            settings={settings.tagger}
            onUpdate={handleUpdateTaggerSettings}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <RatingScoreSettings />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <SimilaritySettings />
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <Paper sx={{ width: '100%' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={promptTabValue}
                onChange={(_event, newValue) => setPromptTabValue(newValue)}
                aria-label="prompt management tabs"
              >
                <Tab label="Positive 프롬프트" />
                <Tab label="Negative 프롬프트" />
              </Tabs>
            </Box>

            <Box sx={{ p: 3 }}>
              {promptTabValue === 0 && <PromptList type="positive" />}
              {promptTabValue === 1 && <PromptList type="negative" />}
            </Box>
          </Paper>
        </TabPanel>

        <TabPanel value={tabValue} index={5}>
          <Alert severity="info">
            고급 설정 기능은 향후 추가될 예정입니다.
          </Alert>
        </TabPanel>
      </Box>
    </Container>
  );
};

export default SettingsPage;
