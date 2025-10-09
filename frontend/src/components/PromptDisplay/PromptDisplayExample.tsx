import React from 'react';
import { Box, Typography, Button, Stack } from '@mui/material';
import PromptDisplay from './PromptDisplay';

const PromptDisplayExample: React.FC = () => {
  const [mode, setMode] = React.useState<'text' | 'grouped'>('text');

  return (
    <Box sx={{ p: 3, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h4" gutterBottom>
        PromptDisplay 컴포넌트 예제
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Button
          variant={mode === 'text' ? 'contained' : 'outlined'}
          onClick={() => setMode('text')}
        >
          텍스트 모드
        </Button>
        <Button
          variant={mode === 'grouped' ? 'contained' : 'outlined'}
          onClick={() => setMode('grouped')}
        >
          그룹별 배지 모드
        </Button>
      </Stack>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {mode === 'text' ? (
          <PromptDisplay
            prompt="masterpiece, best quality, amazing quality, very aesthetic, face emphasis, 1girl, brown hair, brown eyes, long hair"
            negativePrompt="worst quality, 3d, bad_hands, cropped, noisy, text, text bobble, haze, murkily, blurry background, clones, mutation, logo, artist signature, censored"
            showLabels={true}
            variant="outlined"
            showGrouped={false}
          />
        ) : (
          <PromptDisplay
            showGrouped={true}
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
};

export default PromptDisplayExample;