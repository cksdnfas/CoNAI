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
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, ComplexSearchRequest, FilterGroupType } from '@comfyui-image-manager/shared';
import SimpleSearchTab, { type SearchToken } from './SimpleSearchTab';
import AdvancedSearchTab from './AdvancedSearchTab';
import type { FilterBlockData } from '../FilterBuilder/FilterBlockList';
import type { PromptSearchResult } from './SearchAutoComplete';
import { promptCollectionApi } from '../../services/api/promptApi';

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

  // Simple search state -> Token based state
  const [simpleSearchText, setSimpleSearchText] = useState('');
  const [searchTokens, setSearchTokens] = useState<SearchToken[]>([]);

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

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
      logic: 'OR',
      count: tag.usage_count
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
        'OR': 'AND',
        'AND': 'NOT',
        'NOT': 'OR'
      };
      return { ...t, logic: map[t.logic] };
    }));
  };

  // Search handlers
  const handleUpdateToken = (id: string, updates: Partial<SearchToken>) => {
    setSearchTokens(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

    // If type changed, fetch new count
    if (updates.type) {
      const token = searchTokens.find(t => t.id === id);
      if (token) {
        const newType = updates.type;
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

  const handleSearch = () => {
    setValidationError(null);

    // Simple Search (Token based)
    const excludeGroup: FilterCondition[] = [];
    const orGroup: FilterCondition[] = [];
    const andGroup: FilterCondition[] = [];

    // Include text in input if any
    const tokensToProcess = [...searchTokens];
    if (simpleSearchText.trim()) {
      tokensToProcess.push({
        id: 'temp',
        type: 'positive',
        label: simpleSearchText.trim(),
        value: simpleSearchText.trim(),
        logic: 'OR'
      });
    }

    if (tokensToProcess.length === 0) {
      onSearch({ page: 1, limit: 25 });
      return;
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
      }

      const condition: FilterCondition = {
        category,
        type,
        value: token.value,
        ...(token.type === 'auto' && {
          min_score: token.minScore ?? 0,
          max_score: token.maxScore ?? 1
        })
      };

      if (token.logic === 'OR') orGroup.push(condition);
      else if (token.logic === 'AND') andGroup.push(condition);
      else if (token.logic === 'NOT') excludeGroup.push(condition);
    });

    const request: ComplexSearchRequest = {
      complex_filter: {
        exclude_group: excludeGroup.length > 0 ? excludeGroup : undefined,
        or_group: orGroup.length > 0 ? orGroup : undefined,
        and_group: andGroup.length > 0 ? andGroup : undefined,
      },
      page: 1,
      limit: 25,
    };

    onSearch(request);
  };

  const handleClearSearch = () => {
    setSimpleSearchText('');
    setSearchTokens([]);
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
      <Stack direction="row" spacing={2} sx={{ mt: 3, alignItems: 'center' }}>
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
              }}
            >
              <ClearIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
};

export default SearchBar;
