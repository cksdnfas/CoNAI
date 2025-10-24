import React from 'react';
import {
  Box,
  TextField,
  Typography,
  Stack,
  InputAdornment,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

interface SimpleSearchTabProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  onKeyPress: (event: React.KeyboardEvent) => void;
}

const SimpleSearchTab: React.FC<SimpleSearchTabProps> = ({
  searchText,
  onSearchTextChange,
  onKeyPress,
}) => {
  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        프롬프트와 오토태그에서 검색합니다. 가중치는 고려하지 않습니다.
      </Typography>

      <TextField
        fullWidth
        variant="outlined"
        placeholder="검색어를 입력하세요 (예: girl, masterpiece, hatsune miku)"
        value={searchText}
        onChange={(e) => onSearchTextChange(e.target.value)}
        onKeyPress={onKeyPress}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
      />

      <Stack spacing={1}>
        <Typography variant="caption" color="text.secondary">
          💡 <strong>팁</strong>: 일반 검색은 빠르고 간단합니다.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          • 긍정 프롬프트, 네거티브 프롬프트, 오토태그의 General/Character 태그에서 검색
        </Typography>
        <Typography variant="caption" color="text.secondary">
          • 복잡한 조건이 필요하면 "고급 검색" 탭을 사용하세요
        </Typography>
      </Stack>
    </Box>
  );
};

export default SimpleSearchTab;
