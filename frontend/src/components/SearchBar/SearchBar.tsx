import React, { useState } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  History as HistoryIcon,
  Restore as RestoreIcon,
  CreateNewFolder as CreateGroupIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, ComplexSearchRequest, FilterGroupType, ComplexFilter } from '@comfyui-image-manager/shared';
import SimpleSearchTab, { type SearchToken } from './SimpleSearchTab';
// import AdvancedSearchTab from './AdvancedSearchTab'; // Unused in this file according to read content, keeping if it was there? It was in read content.
import type { FilterBlockData } from '../FilterBuilder/FilterBlockList';
import type { PromptSearchResult } from './SearchAutoComplete';
import { promptCollectionApi } from '../../services/api/promptApi';
import { useSearchHistory, type SearchHistoryItem } from '../../hooks/useSearchHistory';
import { Chip, Typography, Divider, Paper } from '@mui/material';
import GroupCreateEditModal from '../../pages/ImageGroups/components/GroupCreateEditModal';

interface SearchBarProps {
  onSearch: (request: ComplexSearchRequest) => void;
  loading?: boolean;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`search-tabpanel-${index}`}
      aria-labelledby={`search-tab-${index}`}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
};

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, loading = false }) => {
  const { t } = useTranslation();
  const { history, addHistoryItem, removeHistoryItem, clearHistory } = useSearchHistory();

  // Simple search state -> Token based state
  const [simpleSearchText, setSimpleSearchText] = useState(() => {
    try {
      return sessionStorage.getItem('search_simpleSearchText') || '';
    } catch {
      return '';
    }
  });

  const [searchTokens, setSearchTokens] = useState<SearchToken[]>(() => {
    try {
      const saved = sessionStorage.getItem('search_searchTokens');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Save state to sessionStorage on change
  React.useEffect(() => {
    try {
      sessionStorage.setItem('search_simpleSearchText', simpleSearchText);
      sessionStorage.setItem('search_searchTokens', JSON.stringify(searchTokens));
    } catch (e) {
      console.error('Failed to save search state into sessionStorage', e);
    }
  }, [simpleSearchText, searchTokens]);

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Group Create Modal State
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupInitialConditions, setGroupInitialConditions] = useState<ComplexFilter | undefined>(undefined);

  // Token Handlers for Simple Tab
  const handleAddToken = (tag: PromptSearchResult) => {
    if (searchTokens.some(t => t.value === tag.prompt && t.type === tag.type)) {
      return;
    }
    const newToken: SearchToken = {
      id: `${Date.now()}-${Math.random()}`,
      type: tag.type,
      label: tag.prompt,
      value: tag.prompt,
      logic: 'AND',
      count: tag.usage_count,
      minScore: tag.min_score,
      maxScore: tag.max_score,
      color: tag.color
    };
    setSearchTokens([...searchTokens, newToken]);
    setSimpleSearchText('');
  };

  const handleRemoveToken = (id: string) => {
    setSearchTokens(searchTokens.filter(t => t.id !== id));
  };

  const handleCycleLogic = (id: string) => {
    setSearchTokens(searchTokens.map(t => {
      if (t.id !== id) return t;
      const map: Record<string, 'OR' | 'AND' | 'NOT'> = {
        'AND': 'OR',
        'OR': 'NOT',
        'NOT': 'AND'
      };
      return { ...t, logic: map[t.logic] };
    }));
  };

  // Search handlers
  const handleUpdateToken = (id: string, updates: Partial<SearchToken>) => {
    setSearchTokens(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

    // If type changed, fetch new count (Skip for rating)
    if (updates.type && updates.type !== 'rating') {
      const token = searchTokens.find(t => t.id === id);
      if (token) {
        const newType = updates.type!;
        const query = token.value; // The raw prompt text

        // Async fetch count for the new type
        (async () => {
          try {
            // 'auto' type handling might need specific API support or just treat as 'auto' in search
            const apiType = newType === 'auto' ? 'auto' : newType;
            const res = await promptCollectionApi.searchPrompts(query, apiType, 1, 10); // fetch a few to ensure match

            // The API returns { data: PromptSearchResult[], ... } or similar structure
            // We need to check exact match for query
            const results = (res as any).data || (res as any).prompts;

            if (Array.isArray(results)) {
              const match = results.find((p: any) => p.prompt === query);
              if (match) {
                setSearchTokens(current => current.map(t =>
                  t.id === id ? { ...t, count: match.usage_count } : t
                ));
              } else {
                // Not found in the new category -> count is effectively 0 (or we leave it undefined)
                // Keeping it undefined is fine as we already cleared it
              }
            }
          } catch (error) {
            console.error('Failed to fetch stats for updated token:', error);
          }
        })();
      }
    }
  };

  const buildComplexFilter = (text: string, tokens: SearchToken[]) => {
    const excludeGroup: FilterCondition[] = [];
    const orGroup: FilterCondition[] = [];
    const andGroup: FilterCondition[] = [];

    // Include text in input if any
    const tokensToProcess = [...tokens];
    if (text.trim()) {
      tokensToProcess.push({
        id: 'temp',
        type: 'positive',
        label: text.trim(),
        value: text.trim(),
        logic: 'OR'
      });
    }

    if (tokensToProcess.length === 0) {
      return null;
    }

    tokensToProcess.forEach(token => {
      let category: FilterCondition['category'] = 'positive_prompt';
      let type: FilterCondition['type'] = 'prompt_contains';

      if (token.type === 'auto') {
        type = 'auto_tag_any';
        category = 'auto_tag';
      } else if (token.type === 'negative') {
        type = 'negative_prompt_contains';
        category = 'negative_prompt';
      } else if (token.type === 'rating') {
        type = 'auto_tag_rating_score';
        category = 'auto_tag';
      }

      const condition: FilterCondition = {
        category,
        type,
        value: token.value,
        ...((token.type === 'auto' || token.type === 'rating') && {
          min_score: token.minScore ?? 0,
          max_score: token.maxScore ?? (token.type === 'rating' ? undefined : 1)
        })
      };

      if (token.logic === 'OR') orGroup.push(condition);
      else if (token.logic === 'AND') andGroup.push(condition);
      else if (token.logic === 'NOT') excludeGroup.push(condition);
    });

    return {
      exclude_group: excludeGroup.length > 0 ? excludeGroup : undefined,
      or_group: orGroup.length > 0 ? orGroup : undefined,
      and_group: andGroup.length > 0 ? andGroup : undefined,
    };
  };

  const performSearch = (text: string, tokens: SearchToken[]) => {
    setValidationError(null);

    // Save to history (if initiated by user action that should save)
    addHistoryItem(text, tokens);

    const complexFilter = buildComplexFilter(text, tokens);

    if (!complexFilter) {
      onSearch({ page: 1, limit: 25 });
      return;
    }

    const request: ComplexSearchRequest = {
      complex_filter: complexFilter,
      page: 1,
      limit: 25,
    };

    onSearch(request);
  };

  const handleCreateGroupWithFilter = () => {
    const complexFilter = buildComplexFilter(simpleSearchText, searchTokens);
    if (complexFilter) {
      setGroupInitialConditions(complexFilter);
      setGroupModalOpen(true);
    }
  };

  const handleSearch = () => {
    performSearch(simpleSearchText, searchTokens);
  };

  const handleClearSearch = () => {
    setSimpleSearchText('');
    setSearchTokens([]);
    sessionStorage.removeItem('search_simpleSearchText');
    sessionStorage.removeItem('search_searchTokens');
  };

  const handleRestoreHistory = (item: SearchHistoryItem) => {
    // Manually update session storage to ensure persistence even if component remounts immediately
    try {
      sessionStorage.setItem('search_simpleSearchText', item.text);
      sessionStorage.setItem('search_searchTokens', JSON.stringify(item.tokens));
    } catch (e) {
      console.error('Failed to save search state to sessionStorage during restore', e);
    }

    setSimpleSearchText(item.text);
    setSearchTokens(item.tokens);
    performSearch(item.text, item.tokens);
  };

  const hasConditions = simpleSearchText.trim().length > 0 || searchTokens.length > 0;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Validation Error Message */}
      {validationError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setValidationError(null)}>
          {validationError}
        </Alert>
      )}

      <SimpleSearchTab
        searchText={simpleSearchText}
        onSearchTextChange={setSimpleSearchText}
        onSearch={handleSearch}
        tokens={searchTokens}
        onAddToken={handleAddToken}
        onRemoveToken={handleRemoveToken}
        onCycleLogic={handleCycleLogic}
        onUpdateToken={handleUpdateToken}
      />

      {/* Action Buttons */}
      <Stack direction="column" spacing={1} sx={{ mt: 3 }}>
        <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
          <Button
            variant="contained"
            size="medium"
            startIcon={<SearchIcon />}
            onClick={handleSearch}
            disabled={loading || !hasConditions}
            fullWidth
            sx={{ py: 1 }}
          >
            {loading ? t('search:searchBar.buttons.searching') : t('search:searchBar.buttons.search')}
          </Button>
          <Tooltip title={t('search:searchBar.buttons.reset')} arrow>
            <span>
              <IconButton
                onClick={handleClearSearch}
                disabled={loading || !hasConditions}
                color="default"
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                  height: '100%',
                  aspectRatio: '1/1',
                  borderRadius: 1
                }}
              >
                <ClearIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <Button
          variant="outlined"
          size="medium"
          startIcon={<CreateGroupIcon />}
          onClick={handleCreateGroupWithFilter}
          disabled={loading || !hasConditions}
          fullWidth
          sx={{ py: 1 }}
        >
          {t('search:searchBar.buttons.createGroupWithFilter')}
        </Button>
      </Stack>

      {/* Recent Search History */}
      {history.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HistoryIcon fontSize="small" />
              {t('Recent Searches', 'Recent Searches')}
            </Typography>
            <Button size="small" onClick={clearHistory} color="inherit" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
              {t('Clear History', 'Clear History')}
            </Button>
          </Stack>

          <Stack spacing={1}>
            {history.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  cursor: 'pointer',
                  transition: '0.2s',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    borderColor: 'primary.main'
                  }
                }}
                onClick={() => handleRestoreHistory(item)}
              >
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', overflow: 'hidden' }}>
                  {item.text && (
                    <Typography variant="body2" fontWeight={500}>{item.text}</Typography>
                  )}
                  {item.tokens.map((token) => (
                    <Chip
                      key={token.id}
                      label={token.label}
                      size="small"
                      color={token.type === 'positive' ? 'success' : token.type === 'negative' ? 'error' : 'warning'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  ))}
                  {item.tokens.length === 0 && !item.text && (
                    <Typography variant="caption" color="text.disabled">Empty Search</Typography>
                  )}
                </Box>
                <Tooltip title={t('Remove', 'Remove')}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeHistoryItem(item.id);
                    }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Paper>
            ))}
          </Stack>

          <GroupCreateEditModal
            open={groupModalOpen}
            onClose={() => setGroupModalOpen(false)}
            onSuccess={() => setGroupModalOpen(false)}
            initialAutoCollectConditions={groupInitialConditions}
          />
        </Box>
      )}
    </Box>
  );
};

export default SearchBar;
