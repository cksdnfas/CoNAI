import { useState, useEffect } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Typography
} from '@mui/material';
import {
  Workspaces as WorkflowIcon,
  Settings as SettingsIcon,
  AutoAwesome as NAIIcon
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WorkflowsTab from './WorkflowsTab';
import ServersTab from './ServersTab';
import NAITab from './NAI/NAITab';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`image-generation-tabpanel-${index}`}
      aria-labelledby={`image-generation-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export default function ImageGenerationPage() {
  const { t } = useTranslation(['imageGeneration']);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [currentTab, setCurrentTab] = useState(0);

  useEffect(() => {
    if (tabParam === 'servers') {
      setCurrentTab(1);
    } else if (tabParam === 'nai') {
      setCurrentTab(2);
    } else {
      setCurrentTab(0);
    }
  }, [tabParam]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
    if (newValue === 0) {
      setSearchParams({ tab: 'workflows' });
    } else if (newValue === 1) {
      setSearchParams({ tab: 'servers' });
    } else {
      setSearchParams({ tab: 'nai' });
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          {t('imageGeneration:page.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('imageGeneration:page.subtitle')}
        </Typography>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={currentTab} onChange={handleTabChange} aria-label={t('imageGeneration:tabs.ariaLabel')}>
          <Tab
            icon={<WorkflowIcon />}
            iconPosition="start"
            label={t('imageGeneration:tabs.workflows')}
            id="image-generation-tab-0"
            aria-controls="image-generation-tabpanel-0"
          />
          <Tab
            icon={<SettingsIcon />}
            iconPosition="start"
            label={t('imageGeneration:tabs.servers')}
            id="image-generation-tab-1"
            aria-controls="image-generation-tabpanel-1"
          />
          <Tab
            icon={<NAIIcon />}
            iconPosition="start"
            label={t('imageGeneration:tabs.novelai')}
            id="image-generation-tab-2"
            aria-controls="image-generation-tabpanel-2"
          />
        </Tabs>
      </Box>

      <TabPanel value={currentTab} index={0}>
        <WorkflowsTab />
      </TabPanel>
      <TabPanel value={currentTab} index={1}>
        <ServersTab />
      </TabPanel>
      <TabPanel value={currentTab} index={2}>
        <NAITab />
      </TabPanel>
    </Box>
  );
}
