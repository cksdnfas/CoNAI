import React, { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import TaggerSettings from './components/TaggerSettings';
import { settingsApi, type AppSettings, type TaggerSettings as TaggerSettingsType } from '../../services/settingsApi';

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
  const [tabValue, setTabValue] = useState(0);
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

  const handleUpdateTaggerSettings = async (taggerSettings: Partial<TaggerSettingsType>) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const updatedSettings = await settingsApi.updateTaggerSettings(taggerSettings);
      setSettings(updatedSettings);
      setSuccessMessage('설정이 성공적으로 저장되었습니다.');

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      setError('Failed to update settings');
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
              설정
            </Typography>
          </Box>
          <Typography variant="body1" color="text.secondary">
            ComfyUI Image Manager 애플리케이션 설정을 관리합니다.
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
            <Tab label="Tagger 설정" />
            <Tab label="고급 설정" disabled />
          </Tabs>
        </Box>

        {/* Tab Panels */}
        <TabPanel value={tabValue} index={0}>
          <TaggerSettings
            settings={settings.tagger}
            onUpdate={handleUpdateTaggerSettings}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Alert severity="info">
            고급 설정 기능은 향후 추가될 예정입니다.
          </Alert>
        </TabPanel>
      </Box>
    </Container>
  );
};

export default SettingsPage;
