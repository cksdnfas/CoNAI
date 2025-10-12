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
  Slider,
  Switch,
  FormControlLabel,
  Divider,
} from '@mui/material';
import {
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  Clear as ClearIcon,
  FilterAlt as FilterIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import type { ImageSearchParams, AutoTagSearchParams, TagFilter } from '../../types/image';

interface SearchBarProps {
  onSearch: (params: ImageSearchParams, autoTagParams?: AutoTagSearchParams) => void;
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

  // AutoTag 검색 상태
  const [autoTagEnabled, setAutoTagEnabled] = useState(false);
  const [hasAutoTags, setHasAutoTags] = useState<boolean | undefined>(undefined);
  const [ratingType, setRatingType] = useState<string>(''); // '', 'general', 'sensitive', 'questionable', 'explicit'
  const [ratingRange, setRatingRange] = useState<[number, number]>([0, 1]);
  const [generalTags, setGeneralTags] = useState<TagFilter[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagScoreRange, setNewTagScoreRange] = useState<[number, number]>([0, 1]);
  const [characterName, setCharacterName] = useState('');
  const [characterScoreRange, setCharacterScoreRange] = useState<[number, number]>([0, 1]);
  const [hasCharacter, setHasCharacter] = useState<boolean | undefined>(undefined);

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

    // AutoTag 검색 파라미터 생성
    let autoTagParams: AutoTagSearchParams | undefined = undefined;
    if (autoTagEnabled) {
      autoTagParams = {
        has_auto_tags: hasAutoTags,
        page: searchParams.page,
        limit: searchParams.limit,
      };

      // Rating 필터
      if (ratingType && (ratingRange[0] > 0 || ratingRange[1] < 1)) {
        autoTagParams.rating = {
          [ratingType]: { min: ratingRange[0], max: ratingRange[1] }
        };
      }

      // General Tags
      if (generalTags.length > 0) {
        autoTagParams.general_tags = generalTags;
      }

      // Character 필터
      if (characterName || hasCharacter !== undefined) {
        autoTagParams.character = {
          name: characterName || undefined,
          min_score: characterName ? characterScoreRange[0] : undefined,
          max_score: characterName ? characterScoreRange[1] : undefined,
          has_character: hasCharacter,
        };
      }
    }

    onSearch(searchParams, autoTagParams);
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

    // AutoTag 상태 초기화
    setAutoTagEnabled(false);
    setHasAutoTags(undefined);
    setRatingType('');
    setRatingRange([0, 1]);
    setGeneralTags([]);
    setNewTagName('');
    setNewTagScoreRange([0, 1]);
    setCharacterName('');
    setCharacterScoreRange([0, 1]);
    setHasCharacter(undefined);
  };

  const handleAddTag = () => {
    if (newTagName.trim()) {
      setGeneralTags([...generalTags, {
        tag: newTagName.trim(),
        min_score: newTagScoreRange[0],
        max_score: newTagScoreRange[1]
      }]);
      setNewTagName('');
      setNewTagScoreRange([0, 1]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setGeneralTags(generalTags.filter((_, i) => i !== index));
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
  ) || autoTagEnabled;

  const aiTools = [
    'ComfyUI',
    'NovelAI',
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

            {/* 오토태그 필터 섹션 */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ mb: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={autoTagEnabled}
                      onChange={(e) => setAutoTagEnabled(e.target.checked)}
                    />
                  }
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" fontWeight="medium">
                        오토태그 검색 활성화
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        (WD v3 Tagger 기반)
                      </Typography>
                    </Box>
                  }
                />
              </Box>

              {autoTagEnabled && (
                <Grid container spacing={2}>
                  {/* 오토태그 존재 여부 */}
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>오토태그 존재</InputLabel>
                      <Select
                        value={hasAutoTags === undefined ? 'all' : hasAutoTags ? 'true' : 'false'}
                        label="오토태그 존재"
                        onChange={(e) => {
                          const val = e.target.value;
                          setHasAutoTags(val === 'all' ? undefined : val === 'true');
                        }}
                      >
                        <MenuItem value="all">전체</MenuItem>
                        <MenuItem value="true">있음</MenuItem>
                        <MenuItem value="false">없음</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* Rating 필터 */}
                  <Grid size={{ xs: 12 }}>
                    {/* <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                      Rating 필터
                    </Typography> */}
                  </Grid>

                  <Grid size={{ xs: 12, sm: 4 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Rating 타입</InputLabel>
                      <Select
                        value={ratingType}
                        label="Rating 타입"
                        onChange={(e) => {
                          setRatingType(e.target.value);
                          setRatingRange([0, 1]); // 타입 변경 시 범위 초기화
                        }}
                      >
                        <MenuItem value="">선택 안함</MenuItem>
                        <MenuItem value="general">General</MenuItem>
                        <MenuItem value="sensitive">Sensitive</MenuItem>
                        <MenuItem value="questionable">Questionable</MenuItem>
                        <MenuItem value="explicit">Explicit</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {ratingType && (
                    <Grid size={{ xs: 12, sm: 8 }}>
                      <Typography variant="caption" color="text.secondary">
                        범위: {ratingRange[0].toFixed(2)} - {ratingRange[1].toFixed(2)}
                      </Typography>
                      <Slider
                        value={ratingRange}
                        onChange={(_, newValue) => setRatingRange(newValue as [number, number])}
                        valueLabelDisplay="auto"
                        min={0}
                        max={1}
                        step={0.01}
                        size="small"
                      />
                    </Grid>
                  )}

                  {/* Character 필터 */}
                  <Grid size={{ xs: 12 }}>
                    {/* <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                      Character 필터
                    </Typography> */}
                  </Grid>

                  <Grid size={{ xs: 12, sm: hasCharacter === false ? 12 : 4 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>캐릭터 존재</InputLabel>
                      <Select
                        value={hasCharacter === undefined ? 'all' : hasCharacter ? 'true' : 'false'}
                        label="캐릭터 존재"
                        onChange={(e) => {
                          const val = e.target.value;
                          setHasCharacter(val === 'all' ? undefined : val === 'true');
                          // "없음" 선택 시 캐릭터명과 점수 초기화
                          if (val === 'false') {
                            setCharacterName('');
                            setCharacterScoreRange([0, 1]);
                          }
                        }}
                      >
                        <MenuItem value="all">전체</MenuItem>
                        <MenuItem value="true">있음</MenuItem>
                        <MenuItem value="false">없음</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  {/* 캐릭터 존재가 "없음"이 아닐 때만 표시 */}
                  {hasCharacter !== false && (
                    <>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          fullWidth
                          size="small"
                          label="캐릭터명"
                          value={characterName}
                          onChange={(e) => setCharacterName(e.target.value)}
                          placeholder="예: hatsune_miku"
                        />
                      </Grid>

                      <Grid size={{ xs: 12, sm: 4 }}>
                        <Typography variant="caption" color="text.secondary">
                          점수 범위: {characterScoreRange[0].toFixed(2)} ~ {characterScoreRange[1].toFixed(2)}
                        </Typography>
                        <Slider
                          value={characterScoreRange}
                          onChange={(_, newValue) => setCharacterScoreRange(newValue as [number, number])}
                          valueLabelDisplay="auto"
                          min={0}
                          max={1}
                          step={0.01}
                          size="small"
                          disabled={!characterName}
                          // marks={[
                          //   { value: 0, label: '0.0' },
                          //   { value: 1, label: '1.0' },
                          // ]}
                        />
                      </Grid>
                    </>
                  )}

                  {/* General Tags 필터 */}
                  <Grid size={{ xs: 12 }}>
                    {/* <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                      General Tags 필터
                    </Typography> */}
                  </Grid>

                  <Grid size={{ xs: 12, sm: 5 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="태그명"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="예: 1girl, solo"
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 5 }}>
                    <Typography variant="caption" color="text.secondary">
                      점수 범위: {newTagScoreRange[0].toFixed(2)} ~ {newTagScoreRange[1].toFixed(2)}
                    </Typography>
                    <Slider
                      value={newTagScoreRange}
                      onChange={(_, newValue) => setNewTagScoreRange(newValue as [number, number])}
                      valueLabelDisplay="auto"
                      min={0}
                      max={1}
                      step={0.01}
                      size="small"
                      // marks={[
                      //   { value: 0, label: '0.0' },
                      //   { value: 1, label: '1.0' },
                      // ]}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 2 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={handleAddTag}
                      startIcon={<AddIcon />}
                      disabled={!newTagName.trim()}
                    >
                      추가
                    </Button>
                  </Grid>

                  {generalTags.length > 0 && (
                    <Grid size={{ xs: 12 }}>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                        {generalTags.map((tag, index) => (
                          <Chip
                            key={index}
                            label={`${tag.tag} (${tag.min_score?.toFixed(2) || 0} ~ ${tag.max_score?.toFixed(2) || 1})`}
                            onDelete={() => handleRemoveTag(index)}
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                    </Grid>
                  )}
                </Grid>
              )}
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