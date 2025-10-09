import React, { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Paper,
} from '@mui/material';

import PromptList from './components/PromptList';

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
      id={`prompt-tabpanel-${index}`}
      aria-labelledby={`prompt-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `prompt-tab-${index}`,
    'aria-controls': `prompt-tabpanel-${index}`,
  };
}

const PromptManagementPage: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          프롬프트 관리
        </Typography>
        <Typography variant="body1" color="text.secondary">
          AI 이미지 생성에 사용된 프롬프트를 분류하고 관리할 수 있습니다.
        </Typography>
      </Box>

      <Paper sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="prompt management tabs">
            <Tab label="Positive 프롬프트" {...a11yProps(0)} />
            <Tab label="Negative 프롬프트" {...a11yProps(1)} />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <PromptList type="positive" />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <PromptList type="negative" />
        </TabPanel>
      </Paper>
    </Container>
  );
};

export default PromptManagementPage;