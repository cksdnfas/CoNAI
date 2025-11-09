import React from 'react';
import {
  Box,
  TextField,
  Typography,
  Stack,
  InputAdornment,
  Tooltip,
  IconButton,
} from '@mui/material';
import { Search as SearchIcon, HelpOutline as HelpIcon } from '@mui/icons-material';

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          긍정 프롬프트와 자동태그에서 검색합니다.
        </Typography>
        <Tooltip
          title={
            <Stack spacing={0.5}>
              <Typography variant="caption">• 검색 범위: 긍정 프롬프트, 자동태그 General/Character</Typography>
              <Typography variant="caption">• 가중치는 무시됩니다</Typography>
              <Typography variant="caption">• 복잡한 조건은 "고급 검색" 사용</Typography>
            </Stack>
          }
          arrow
          placement="right"
        >
          <IconButton size="small" sx={{ p: 0.5 }}>
            <HelpIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

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
      />
    </Box>
  );
};

export default SimpleSearchTab;
