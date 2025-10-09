import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import UploadZone from '../../components/UploadZone/UploadZone';

const UploadPage: React.FC = () => {
  const handleUploadComplete = () => {
    // 업로드 완료 후 필요한 작업 (예: 갤러리 페이지로 이동)
    console.log('Upload completed');
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
        이미지 업로드
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{
          mb: { xs: 3, sm: 4 },
          fontSize: { xs: '0.875rem', sm: '1rem' },
        }}
      >
        AI 생성 이미지를 업로드하면 메타데이터가 자동으로 추출되어 분석됩니다.
      </Typography>

      <UploadZone onUploadComplete={handleUploadComplete} />

      <Paper
        elevation={1}
        sx={{
          p: { xs: 2, sm: 3 },
          mt: { xs: 3, sm: 4 },
          borderRadius: 2,
        }}
      >
        <Typography
          variant="h6"
          gutterBottom
          sx={{
            fontSize: { xs: '1.1rem', sm: '1.25rem' },
            fontWeight: 600,
          }}
        >
          업로드 가이드
        </Typography>
        <Box component="ul" sx={{ pl: { xs: 2, sm: 2 }, m: 0 }}>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            ComfyUI, Stable Diffusion, NovelAI 등에서 생성된 이미지의 메타데이터가 자동으로 추출됩니다.
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            프롬프트, 모델명, 생성 파라미터 등이 자동으로 분석되어 검색과 분류에 활용됩니다.
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            업로드된 이미지는 원본, 최적화본, 썸네일 3가지 버전으로 저장됩니다.
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            자동 그룹 수집 규칙이 설정되어 있으면 업로드와 동시에 관련 그룹에 자동 분류됩니다.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default UploadPage;