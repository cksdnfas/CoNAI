import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  Divider,
  Tabs,
  Tab,
  Card,
  CardContent,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  Clear as ClearIcon,
  FilterAlt as FilterIcon,
  Add as AddIcon,
  Label as LabelIcon,
  Star as StarIcon,
  Person as PersonIcon,
  LocalOffer as TagIcon,
  Today as TodayIcon,
  DateRange as DateRangeIcon,
} from '@mui/icons-material';
import type { ImageSearchParams, AutoTagSearchParams, TagFilter } from '../../types/image';

interface SearchBarProps {
  onSearch: (params: ImageSearchParams, autoTagParams?: AutoTagSearchParams) => void;
  loading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, loading = false }) => {
  const { t } = useTranslation('search');
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

  const [expandedAdvanced, setExpandedAdvanced] = useState(false);
  const [expandedAutoTag, setExpandedAutoTag] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // AutoTag 탭 상태
  const [autoTagTab, setAutoTagTab] = useState(0); // 0: Rating, 1: Character, 2: General Tags
  const [ratingMode, setRatingMode] = useState(0); // 0: Type별, 1: Score 기반
  const [ratingType, setRatingType] = useState<string>('');
  const [ratingRange, setRatingRange] = useState<[number, number]>([0, 1]);
  const [ratingScoreMin, setRatingScoreMin] = useState<number>(0);
  const [ratingScoreMax, setRatingScoreMax] = useState<number>(200);
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

    // AutoTag 검색 파라미터 생성 (expandedAutoTag이 true이고 실제 필터가 있을 때만)
    let autoTagParams: AutoTagSearchParams | undefined = undefined;
    const hasAutoTagFilters = expandedAutoTag && (
      (ratingMode === 0 && ratingType) ||
      (ratingMode === 1 && (ratingScoreMin > 0 || ratingScoreMax < 200)) ||
      generalTags.length > 0 ||
      characterName ||
      hasCharacter !== undefined
    );

    if (hasAutoTagFilters) {
      const params: AutoTagSearchParams = {
        page: searchParams.page,
        limit: searchParams.limit,
      };

      // 기본 검색 파라미터도 함께 전달
      (params as any).search_text = searchParams.search_text;
      (params as any).negative_text = searchParams.negative_text;
      (params as any).ai_tool = searchParams.ai_tool;
      (params as any).model_name = searchParams.model_name;
      (params as any).start_date = searchParams.start_date;
      (params as any).end_date = searchParams.end_date;

      // Rating 필터 - Type별
      if (ratingMode === 0 && ratingType && (ratingRange[0] > 0 || ratingRange[1] < 1)) {
        params.rating = {
          [ratingType]: { min: ratingRange[0], max: ratingRange[1] }
        };
      }

      // Rating Score 필터 - Score 기반
      if (ratingMode === 1 && (ratingScoreMin > 0 || ratingScoreMax < 200)) {
        params.rating_score = {
          min_score: ratingScoreMin > 0 ? ratingScoreMin : undefined,
          max_score: ratingScoreMax < 200 ? ratingScoreMax : undefined,
        };
      }

      // General Tags
      if (generalTags.length > 0) {
        params.general_tags = generalTags;
      }

      // Character 필터
      if (characterName || hasCharacter !== undefined) {
        params.character = {
          name: characterName || undefined,
          min_score: characterName ? characterScoreRange[0] : undefined,
          max_score: characterName ? characterScoreRange[1] : undefined,
          has_character: hasCharacter,
        };
      }

      autoTagParams = params;
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
    setExpandedAutoTag(false);
    setAutoTagTab(0);
    setRatingMode(0);
    setRatingType('');
    setRatingRange([0, 1]);
    setRatingScoreMin(0);
    setRatingScoreMax(200);
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

  // 기본 필터 체크 (search_text, ai_tool, model_name 제외)
  const hasAdvancedFilters = searchParams.negative_text || searchParams.start_date || searchParams.end_date;

  // 오토태그 필터 체크 (실제 필터가 적용되어 있는지 확인)
  const hasAutoTagFiltersActive = (
    (ratingMode === 0 && ratingType) ||
    (ratingMode === 1 && (ratingScoreMin > 0 || ratingScoreMax < 200)) ||
    generalTags.length > 0 ||
    characterName ||
    hasCharacter !== undefined
  );

  const getActiveFilterCount = () => {
    let count = 0;
    if (hasAdvancedFilters) {
      if (searchParams.negative_text) count++;
      if (searchParams.start_date) count++;
      if (searchParams.end_date) count++;
    }
    return count;
  };

  const getAutoTagFilterCount = () => {
    let count = 0;
    if (ratingMode === 0 && ratingType) count++;
    if (ratingMode === 1 && (ratingScoreMin > 0 || ratingScoreMax < 200)) count++;
    if (generalTags.length > 0) count += generalTags.length;
    if (characterName || hasCharacter !== undefined) count++;
    return count;
  };

  const aiTools = [
    'ComfyUI',
    'NovelAI',
  ];

  // 빠른 날짜 필터
  const setQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    setSearchParams(prev => ({
      ...prev,
      start_date: start.toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
    }));
  };

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      {/* 메인 검색 바 */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder={t('searchInput.placeholder')}
          value={searchParams.search_text || ''}
          onChange={handleInputChange('search_text')}
          onKeyPress={handleKeyPress}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
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
                  {t('searchInput.button')}
                </Button>
              </Box>
            ),
          }}
        />
      </Box>

      {/* 기본 필터 (항상 표시) */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControl fullWidth size="small">
            <InputLabel>{t('filters.basic.aiTool.label')}</InputLabel>
            <Select
              value={searchParams.ai_tool || ''}
              label={t('filters.basic.aiTool.label')}
              onChange={handleInputChange('ai_tool')}
            >
              <MenuItem value="">{t('filters.basic.aiTool.all')}</MenuItem>
              {aiTools.map(tool => (
                <MenuItem key={tool} value={tool}>{tool}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            label={t('filters.basic.modelName.label')}
            value={searchParams.model_name || ''}
            onChange={handleInputChange('model_name')}
            placeholder={t('filters.basic.modelName.placeholder')}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="date"
            label={t('filters.basic.startDate.label')}
            value={searchParams.start_date || ''}
            onChange={handleInputChange('start_date')}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField
            fullWidth
            size="small"
            type="date"
            label={t('filters.basic.endDate.label')}
            value={searchParams.end_date || ''}
            onChange={handleInputChange('end_date')}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
      </Grid>

      {/* 빠른 날짜 필터 */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Tooltip title={t('filters.quickDate.todayTooltip')}>
          <Chip
            icon={<TodayIcon />}
            label={t('filters.quickDate.today')}
            size="small"
            onClick={() => setQuickDateRange(0)}
            variant="outlined"
            sx={{ cursor: 'pointer' }}
          />
        </Tooltip>
        <Tooltip title={t('filters.quickDate.7daysTooltip')}>
          <Chip
            icon={<DateRangeIcon />}
            label={t('filters.quickDate.7days')}
            size="small"
            onClick={() => setQuickDateRange(7)}
            variant="outlined"
            sx={{ cursor: 'pointer' }}
          />
        </Tooltip>
        <Tooltip title={t('filters.quickDate.30daysTooltip')}>
          <Chip
            icon={<DateRangeIcon />}
            label={t('filters.quickDate.30days')}
            size="small"
            onClick={() => setQuickDateRange(30)}
            variant="outlined"
            sx={{ cursor: 'pointer' }}
          />
        </Tooltip>
        <Tooltip title={t('filters.quickDate.90daysTooltip')}>
          <Chip
            icon={<DateRangeIcon />}
            label={t('filters.quickDate.90days')}
            size="small"
            onClick={() => setQuickDateRange(90)}
            variant="outlined"
            sx={{ cursor: 'pointer' }}
          />
        </Tooltip>
      </Box>

      {/* 검색 기록 */}
      {searchHistory.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('searchHistory.title')}
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

      {/* 고급 필터 Accordion */}
      <Accordion
        expanded={expandedAdvanced}
        onChange={(_, expanded) => setExpandedAdvanced(expanded)}
        sx={{ mb: 1 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FilterIcon color="primary" />
            <Typography fontWeight="medium">{t('filters.advanced.title')}</Typography>
            {hasAdvancedFilters && (
              <Badge badgeContent={getActiveFilterCount()} color="primary">
                <Chip label={t('filters.advanced.active')} size="small" color="primary" variant="outlined" />
              </Badge>
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                size="small"
                label={t('filters.advanced.negativePrompt.label')}
                value={searchParams.negative_text || ''}
                onChange={handleInputChange('negative_text')}
                placeholder={t('filters.advanced.negativePrompt.placeholder')}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* 오토태그 필터 Accordion */}
      <Accordion
        expanded={expandedAutoTag}
        onChange={(_, expanded) => setExpandedAutoTag(expanded)}
        sx={{ mb: 2 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LabelIcon color="secondary" />
            <Typography fontWeight="medium">{t('filters.autoTag.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('filters.autoTag.subtitle')}
            </Typography>
            {hasAutoTagFiltersActive && (
              <Badge badgeContent={getAutoTagFilterCount()} color="secondary">
                <Chip label={t('filters.autoTag.active')} size="small" color="secondary" variant="outlined" />
              </Badge>
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box>
            {/* 탭 네비게이션 */}
            <Tabs
              value={autoTagTab}
              onChange={(_, newValue) => setAutoTagTab(newValue)}
              variant="fullWidth"
              sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
            >
              <Tab
                icon={<StarIcon />}
                label={t('filters.autoTag.tabs.rating')}
                iconPosition="start"
              />
              <Tab
                icon={<PersonIcon />}
                label={t('filters.autoTag.tabs.character')}
                iconPosition="start"
              />
              <Tab
                icon={<TagIcon />}
                label={t('filters.autoTag.tabs.generalTags')}
                iconPosition="start"
              />
            </Tabs>

            {/* Rating 탭 */}
            {autoTagTab === 0 && (
              <Box>
                <Tabs
                  value={ratingMode}
                  onChange={(_, newValue) => setRatingMode(newValue)}
                  sx={{ mb: 3 }}
                >
                  <Tab label={t('filters.autoTag.rating.typeMode')} />
                  <Tab label={t('filters.autoTag.rating.scoreMode')} />
                </Tabs>

                {ratingMode === 0 && (
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" gutterBottom color="text.secondary">
                        {t('filters.autoTag.rating.typeDescription')}
                      </Typography>
                      <Grid container spacing={2} sx={{ mt: 1 }}>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <FormControl fullWidth size="small">
                            <InputLabel>{t('filters.autoTag.rating.type.label')}</InputLabel>
                            <Select
                              value={ratingType}
                              label={t('filters.autoTag.rating.type.label')}
                              onChange={(e) => {
                                setRatingType(e.target.value);
                                setRatingRange([0, 1]);
                              }}
                            >
                              <MenuItem value="">{t('filters.autoTag.rating.type.none')}</MenuItem>
                              <MenuItem value="general">{t('filters.autoTag.rating.type.general')}</MenuItem>
                              <MenuItem value="sensitive">{t('filters.autoTag.rating.type.sensitive')}</MenuItem>
                              <MenuItem value="questionable">{t('filters.autoTag.rating.type.questionable')}</MenuItem>
                              <MenuItem value="explicit">{t('filters.autoTag.rating.type.explicit')}</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>
                        {ratingType && (
                          <Grid size={{ xs: 12, md: 8 }}>
                            <Box sx={{ px: 2 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                  {t('filters.autoTag.rating.confidenceRange')}
                                </Typography>
                                <Typography variant="caption" fontWeight="bold">
                                  {ratingRange[0].toFixed(2)} ~ {ratingRange[1].toFixed(2)}
                                </Typography>
                              </Box>
                              <Slider
                                value={ratingRange}
                                onChange={(_, newValue) => setRatingRange(newValue as [number, number])}
                                valueLabelDisplay="auto"
                                min={0}
                                max={1}
                                step={0.01}
                                marks={[
                                  { value: 0, label: '0.0' },
                                  { value: 0.5, label: '0.5' },
                                  { value: 1, label: '1.0' },
                                ]}
                              />
                            </Box>
                          </Grid>
                        )}
                      </Grid>
                    </CardContent>
                  </Card>
                )}

                {ratingMode === 1 && (
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" gutterBottom color="text.secondary">
                        {t('filters.autoTag.rating.scoreDescription')}
                      </Typography>
                      <Box sx={{ px: 2, mt: 3 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            {t('filters.autoTag.rating.scoreRange')}
                          </Typography>
                          <Typography variant="caption" fontWeight="bold">
                            {ratingScoreMin} ~ {ratingScoreMax}
                          </Typography>
                        </Box>
                        <Slider
                          value={[ratingScoreMin, ratingScoreMax]}
                          onChange={(_, newValue) => {
                            const [min, max] = newValue as [number, number];
                            setRatingScoreMin(min);
                            setRatingScoreMax(max);
                          }}
                          valueLabelDisplay="auto"
                          min={0}
                          max={200}
                          step={1}
                          marks={[
                            { value: 0, label: '0' },
                            { value: 50, label: '50' },
                            { value: 100, label: '100' },
                            { value: 150, label: '150' },
                            { value: 200, label: '200' },
                          ]}
                        />
                      </Box>
                    </CardContent>
                  </Card>
                )}
              </Box>
            )}

            {/* Character 탭 */}
            {autoTagTab === 1 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom color="text.secondary">
                    {t('filters.autoTag.character.description')}
                  </Typography>
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('filters.autoTag.character.existence.label')}</InputLabel>
                        <Select
                          value={hasCharacter === undefined ? 'all' : hasCharacter ? 'true' : 'false'}
                          label={t('filters.autoTag.character.existence.label')}
                          onChange={(e) => {
                            const val = e.target.value;
                            setHasCharacter(val === 'all' ? undefined : val === 'true');
                            if (val === 'false') {
                              setCharacterName('');
                              setCharacterScoreRange([0, 1]);
                            }
                          }}
                        >
                          <MenuItem value="all">{t('filters.autoTag.character.existence.all')}</MenuItem>
                          <MenuItem value="true">{t('filters.autoTag.character.existence.true')}</MenuItem>
                          <MenuItem value="false">{t('filters.autoTag.character.existence.false')}</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    {hasCharacter !== false && (
                      <>
                        <Grid size={{ xs: 12, sm: 8 }}>
                          <TextField
                            fullWidth
                            size="small"
                            label={t('filters.autoTag.character.name.label')}
                            value={characterName}
                            onChange={(e) => setCharacterName(e.target.value)}
                            placeholder={t('filters.autoTag.character.name.placeholder')}
                          />
                        </Grid>
                        {characterName && (
                          <Grid size={{ xs: 12 }}>
                            <Box sx={{ px: 2 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                  {t('filters.autoTag.character.confidenceRange')}
                                </Typography>
                                <Typography variant="caption" fontWeight="bold">
                                  {characterScoreRange[0].toFixed(2)} ~ {characterScoreRange[1].toFixed(2)}
                                </Typography>
                              </Box>
                              <Slider
                                value={characterScoreRange}
                                onChange={(_, newValue) => setCharacterScoreRange(newValue as [number, number])}
                                valueLabelDisplay="auto"
                                min={0}
                                max={1}
                                step={0.01}
                                marks={[
                                  { value: 0, label: '0.0' },
                                  { value: 0.5, label: '0.5' },
                                  { value: 1, label: '1.0' },
                                ]}
                              />
                            </Box>
                          </Grid>
                        )}
                      </>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            )}

            {/* General Tags 탭 */}
            {autoTagTab === 2 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom color="text.secondary">
                    {t('filters.autoTag.generalTags.description')}
                  </Typography>
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        size="small"
                        label={t('filters.autoTag.generalTags.tagName.label')}
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && newTagName.trim()) {
                            handleAddTag();
                          }
                        }}
                        placeholder={t('filters.autoTag.generalTags.tagName.placeholder')}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {t('filters.autoTag.generalTags.confidence', {
                              min: newTagScoreRange[0].toFixed(2),
                              max: newTagScoreRange[1].toFixed(2)
                            })}
                          </Typography>
                          <Slider
                            value={newTagScoreRange}
                            onChange={(_, newValue) => setNewTagScoreRange(newValue as [number, number])}
                            valueLabelDisplay="auto"
                            min={0}
                            max={1}
                            step={0.01}
                            size="small"
                          />
                        </Box>
                        <Button
                          variant="contained"
                          onClick={handleAddTag}
                          disabled={!newTagName.trim()}
                          sx={{ minWidth: 'auto', px: 2 }}
                        >
                          <AddIcon />
                        </Button>
                      </Box>
                    </Grid>
                    {generalTags.length > 0 && (
                      <Grid size={{ xs: 12 }}>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                          {t('filters.autoTag.generalTags.addedTags', { count: generalTags.length })}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                          {generalTags.map((tag, index) => (
                            <Chip
                              key={index}
                              icon={<TagIcon />}
                              label={`${tag.tag} (${tag.min_score?.toFixed(2) || 0}~${tag.max_score?.toFixed(2) || 1})`}
                              onDelete={() => handleRemoveTag(index)}
                              size="medium"
                              color="secondary"
                              variant="outlined"
                            />
                          ))}
                        </Stack>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            )}
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* 액션 버튼 */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={handleClearSearch}
          disabled={loading}
          startIcon={<ClearIcon />}
        >
          {t('searchInput.clear')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSearch}
          disabled={loading}
          startIcon={<SearchIcon />}
          size="large"
        >
          {t('searchInput.execute')}
        </Button>
      </Box>
    </Paper>
  );
};

export default SearchBar;