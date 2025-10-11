import React, { useState } from 'react';
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AutoTagsData } from '../../types/image';
import { taggerBatchApi } from '../../services/settingsApi';

interface AutoTagDisplayProps {
  imageId: number;
  autoTags: AutoTagsData | null;
  onTagGenerated?: () => void;
}

const AutoTagDisplay: React.FC<AutoTagDisplayProps> = ({
  imageId,
  autoTags,
  onTagGenerated,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateTag = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      await taggerBatchApi.testImage(imageId);
      if (onTagGenerated) {
        onTagGenerated();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '태그 생성 중 오류가 발생했습니다.';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  // 태그가 없는 경우 - 생성 버튼 표시
  if (!autoTags) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          이 이미지는 아직 자동 태깅이 생성되지 않았습니다.
        </Typography>
        <Button
          variant="contained"
          onClick={handleGenerateTag}
          disabled={isGenerating}
          startIcon={isGenerating ? <CircularProgress size={20} /> : undefined}
        >
          {isGenerating ? '생성 중...' : '태그 생성'}
        </Button>
      </Box>
    );
  }

  // Rating 게이지 색상 매핑
  const getRatingColor = (key: string): string => {
    const colorMap: Record<string, string> = {
      general: '#4caf50',      // 녹색
      sensitive: '#ffeb3b',    // 노란색
      questionable: '#ff9800', // 진한 오렌지
      explicit: '#d32f2f',     // 진한 빨강
    };
    return colorMap[key] || '#9e9e9e';
  };

  // General 태그 게이지 색상 (값 크기에 따라)
  const getGeneralTagColor = (value: number): string => {
    if (value < 0.33) return '#9e9e9e'; // 회색
    if (value < 0.66) return '#2196f3'; // 파랑
    return '#4caf50'; // 초록
  };

  // Rating 게이지 렌더링 (HP바 형태)
  const renderRatingGauge = () => {
    const ratings = Object.entries(autoTags.rating)
      .map(([key, value]) => ({
        key,
        value: Math.round(value * 100) / 100, // 소수점 셋째 자리 반올림
        color: getRatingColor(key),
      }))
      .filter(r => r.value > 0);

    const total = ratings.reduce((sum, r) => sum + r.value, 0);

    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Rating
        </Typography>
        <Box
          sx={{
            display: 'flex',
            height: 32,
            borderRadius: 1,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {ratings.map((rating) => (
            <Box
              key={rating.key}
              sx={{
                flex: rating.value / total,
                backgroundColor: rating.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                '&:not(:last-child)': {
                  borderRight: '1px solid rgba(0,0,0,0.1)',
                },
              }}
            >
              {rating.value >= 0.33 && (
                <Typography
                  variant="caption"
                  sx={{
                    color: rating.key === 'sensitive' ? 'rgba(0,0,0,0.7)' : 'white',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    textShadow: rating.key === 'sensitive' ? 'none' : '0 1px 2px rgba(0,0,0,0.3)',
                  }}
                >
                  {rating.key.substring(0, 3).toUpperCase()} {(rating.value * 100).toFixed(0)}%
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        {/* <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
          {ratings.map(rating => (
            <Box key={rating.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '2px',
                  backgroundColor: rating.color,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {rating.key}: {rating.value.toFixed(2)}
              </Typography>
            </Box>
          ))}
        </Box> */}
      </Box>
    );
  };

  // Character 정보 렌더링 (게이지 형태)
  const renderCharacters = () => {
    const characters = Object.entries(autoTags.character)
      .sort((a, b) => b[1] - a[1]); // 점수 높은 순으로 정렬

    if (characters.length === 0) return null;

    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Characters
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {characters.map(([name, score]) => (
            <Box key={name}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                  {name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {(score * 100).toFixed(1)}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={score * 100}
                sx={{
                  height: 6,
                  borderRadius: 1,
                  backgroundColor: 'rgba(0,0,0,0.1)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: getGeneralTagColor(score),
                    borderRadius: 1,
                  },
                }}
              />
            </Box>
          ))}
        </Box>
      </Box>
    );
  };

  // Taglist 렌더링
  const renderTaglist = () => {
    if (!autoTags.taglist) return null;

    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
          Tag List
        </Typography>
        <Typography variant="body2" sx={{ lineHeight: 1.6, wordBreak: 'break-word' }}>
          {autoTags.taglist}
        </Typography>
      </Box>
    );
  };

  // General 태그 렌더링 (접을 수 있는 형태)
  const renderGeneralTags = () => {
    const generalTags = Object.entries(autoTags.general)
      .sort((a, b) => b[1] - a[1]); // 점수 높은 순으로 정렬

    if (generalTags.length === 0) return null;

    return (
      <Accordion defaultExpanded={false}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            General Tags ({generalTags.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {generalTags.map(([tag, score]) => (
              <Box key={tag}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                    {tag}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(score * 100).toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={score * 100}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: 'rgba(0,0,0,0.1)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: getGeneralTagColor(score),
                      borderRadius: 1,
                    },
                  }}
                />
              </Box>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
    );
  };

  // Model & Thresholds 렌더링 (접을 수 있는 형태)
  const renderModelInfo = () => {
    return (
      <Accordion defaultExpanded={false} sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Model Information
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2">
              <strong>Model:</strong> {autoTags.model}
            </Typography>
            <Typography variant="body2">
              <strong>General Threshold:</strong> {autoTags.thresholds.general}
            </Typography>
            <Typography variant="body2">
              <strong>Character Threshold:</strong> {autoTags.thresholds.character}
            </Typography>
            {autoTags.tagged_at && (
              <Typography variant="body2">
                <strong>Tagged At:</strong>{' '}
                {new Date(autoTags.tagged_at).toLocaleString('ko-KR')}
              </Typography>
            )}
          </Box>
        </AccordionDetails>
      </Accordion>
    );
  };

  return (
    <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
      {renderRatingGauge()}
      {renderModelInfo()}
      {renderCharacters()}
      {renderTaglist()}
      {renderGeneralTags()}
    </Box>
  );
};

export default AutoTagDisplay;
