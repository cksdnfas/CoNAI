import React from 'react';
import { Box, Typography, Divider } from '@mui/material';
import WatchedFoldersList from './components/WatchedFoldersList';
import BackgroundStatusMonitor from './BackgroundStatusMonitor';

const FolderSettings: React.FC = () => {
  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        폴더 관리
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        감시 폴더를 설정하고, 백그라운드 작업 상태를 모니터링합니다.
      </Typography>

      {/* 백그라운드 작업 모니터링 */}
      <Box sx={{ mb: 4 }}>
        <BackgroundStatusMonitor />
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* 감시 폴더 목록 */}
      <Box>
        <WatchedFoldersList />
      </Box>
    </Box>
  );
};

export default FolderSettings;
