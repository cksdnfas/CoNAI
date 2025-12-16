import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import UploadZone from '../../components/UploadZone/UploadZone';
import PromptPreview from '../../components/PromptPreview/PromptPreview';

const UploadPage: React.FC = () => {
  const { t } = useTranslation(['upload', 'common']);

  const queryClient = useQueryClient();

  const handleUploadComplete = () => {
    // 업로드 완료 후 필요한 작업 (예: 갤러리 페이지로 이동)
    console.log('Upload completed');
    // 갤러리 갱신을 위해 캐시 무효화
    queryClient.invalidateQueries({ queryKey: ['images'] });
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{
          fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
          fontWeight: 600,
        }}
      >
        {t('upload:page.title')}
      </Typography>


      <UploadZone onUploadComplete={handleUploadComplete} />

      {/* Prompt Preview Section */}
      <PromptPreview />
    </Box>
  );
};

export default UploadPage;