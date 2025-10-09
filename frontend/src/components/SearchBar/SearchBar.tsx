import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Paper,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Chip,
  Stack,
} from '@mui/material';
import {
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  Clear as ClearIcon,
  FilterAlt as FilterIcon,
} from '@mui/icons-material';
import type { ImageSearchParams } from '../../types/image';

interface SearchBarProps {
  onSearch: (params: ImageSearchParams) => void;
  loading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, loading = false }) => {
  const [searchParams, setSearchParams] = useState<ImageSearchParams>({
    search_text: '',
    negative_text: '',
    ai_tool: '',
    model_name: '',
    start_date: '',
    end_date: '',
    page: 1,
    limit: 25,
  });

  const [expandedFilters, setExpandedFilters] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const handleInputChange = (field: keyof ImageSearchParams) => (
    event: any
  ) => {
    const value = event.target.value;
    setSearchParams(prev => ({
      ...prev,
      [field]: value === '' ? undefined : value,
    }));
  };


  const handleSearch = () => {
    // 검색 기록에 추가
    if (searchParams.search_text && !searchHistory.includes(searchParams.search_text)) {
      const newHistory = [searchParams.search_text, ...searchHistory].slice(0, 10);
      setSearchHistory(newHistory);
      localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    }

    onSearch(searchParams);
  };

  const handleClearSearch = () => {
    setSearchParams({
      search_text: '',
      negative_text: '',
      ai_tool: '',
      model_name: '',
      start_date: '',
      end_date: '',
      page: 1,
      limit: 25,
    });
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  const handleHistoryClick = (query: string) => {
    setSearchParams(prev => ({ ...prev, search_text: query }));
  };

  const removeFromHistory = (query: string) => {
    const newHistory = searchHistory.filter(item => item !== query);
    setSearchHistory(newHistory);
    localStorage.setItem('searchHistory', JSON.stringify(newHistory));
  };

  // 컴포넌트 마운트 시 검색 기록 복원
  React.useEffect(() => {
    const saved = localStorage.getItem('searchHistory');
    if (saved) {
      try {
        setSearchHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse search history:', e);
      }
    }
  }, []);

  const hasActiveFilters = Object.values(searchParams).some(value =>
    value !== '' && value !== undefined && value !== 1 && value !== 25
  );

  const aiTools = [
    'ComfyUI',
    'Stable Diffusion',
    'NovelAI',
    'Automatic1111',
    'InvokeAI',
    'Midjourney',
    'DALL-E',
  ];

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      {/* 메인 검색 바 */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="프롬프트 키워드로 검색..."
          value={searchParams.search_text || ''}
          onChange={handleInputChange('search_text')}
          onKeyPress={handleKeyPress}
          InputProps={{
            endAdornment: (
              <Box sx={{ display: 'flex', gap: 1 }}>
                {searchParams.search_text && (
                  <IconButton size="small" onClick={() => setSearchParams(prev => ({ ...prev, search_text: '' }))}>
                    <ClearIcon />
                  </IconButton>
                )}
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  disabled={loading}
                  sx={{ minWidth: 'auto', px: 2 }}
                >
                  <SearchIcon />
                </Button>
              </Box>
            ),
          }}
        />
      </Box>

      {/* 검색 기록 */}
      {searchHistory.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            최근 검색어
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {searchHistory.map((query, index) => (
              <Chip
                key={index}
                label={query}
                size="small"
                onClick={() => handleHistoryClick(query)}
                onDelete={() => removeFromHistory(query)}
                variant="outlined"
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* 고급 필터 */}
      <Accordion expanded={expandedFilters} onChange={(_, expanded) => setExpandedFilters(expanded)}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FilterIcon />
            <Typography>고급 검색 필터</Typography>
            {hasActiveFilters && (
              <Chip
                label="필터 활성"
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            {/* AI 도구 */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>AI 도구</InputLabel>
                <Select
                  value={searchParams.ai_tool || ''}
                  label="AI 도구"
                  onChange={handleInputChange('ai_tool')}
                >
                  <MenuItem value="">전체</MenuItem>
                  {aiTools.map(tool => (
                    <MenuItem key={tool} value={tool}>{tool}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* 모델명 */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                label="모델명"
                value={searchParams.model_name || ''}
                onChange={handleInputChange('model_name')}
                placeholder="예: sd_xl_base_1.0"
              />
            </Grid>

            {/* 네거티브 프롬프트 */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                label="네거티브 프롬프트"
                value={searchParams.negative_text || ''}
                onChange={handleInputChange('negative_text')}
                placeholder="예: ugly, blurry"
              />
            </Grid>

            {/* 시작 날짜 */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="시작 날짜"
                value={searchParams.start_date || ''}
                onChange={handleInputChange('start_date')}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* 종료 날짜 */}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="종료 날짜"
                value={searchParams.end_date || ''}
                onChange={handleInputChange('end_date')}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* 액션 버튼 */}
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <Button
                  variant="outlined"
                  onClick={handleClearSearch}
                  disabled={loading}
                  startIcon={<ClearIcon />}
                >
                  초기화
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSearch}
                  disabled={loading}
                  startIcon={<SearchIcon />}
                >
                  검색
                </Button>
              </Box>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
};

export default SearchBar;