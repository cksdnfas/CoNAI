import React, { useState, useEffect } from 'react';
import { Box, Typography, Divider, Paper, TextField, Button, Alert, Tooltip } from '@mui/material';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { InfoTooltip } from '../../../../components/common';
import WatchedFoldersList from './components/WatchedFoldersList';
import BackgroundStatusMonitor from './BackgroundStatusMonitor';

const FolderSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  // Unused settings removed
  // const [phase2Interval, setPhase2Interval] = useState<number>(30);
  // const [autoTagPollingInterval, setAutoTagPollingInterval] = useState<number>(30); 
  // ... removed for cleanup

  return (
    <Box>




      {/* 백그라운드 작업 모니터링 */}
      <Box sx={{ mb: 3 }}>
        <BackgroundStatusMonitor />
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* 감시 폴더 목록 */}
      <Box>
        <WatchedFoldersList />
      </Box>
    </Box>
  );
};

export default FolderSettings;
