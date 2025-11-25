import React, { useState } from 'react';
import {
  Box,
  Paper,
  Tabs,
  Tab,
  Button,
  Stack,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, ComplexSearchRequest, FilterGroupType } from '@comfyui-image-manager/shared';
import SimpleSearchTab from './SimpleSearchTab';
import AdvancedSearchTab from './AdvancedSearchTab';
import type { FilterBlockData } from '../FilterBuilder/FilterBlockList';

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

  // Tab state
  const [activeTab, setActiveTab] = useState(0); // 0: Simple, 1: Advanced

  // Simple search state
  const [simpleSearchText, setSimpleSearchText] = useState('');

  // Advanced search state - Unified filter blocks
  const [filterBlocks, setFilterBlocks] = useState<FilterBlockData[]>([]);

  // Validation error state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Filter block handlers
  const handleAddBlock = (groupType: FilterGroupType, condition: FilterCondition) => {
    const newBlock: FilterBlockData = {
      id: `${Date.now()}-${Math.random()}`, // 간단한 unique ID 생성
      groupType,
      condition,
    };
    setFilterBlocks([...filterBlocks, newBlock]);
  };

  const handleEditBlock = (id: string, groupType: FilterGroupType, condition: FilterCondition) => {
    setFilterBlocks(
      filterBlocks.map((block) =>
        block.id === id ? { ...block, groupType, condition } : block
      )
    );
  };

  const handleRemoveBlock = (id: string) => {
    setFilterBlocks(filterBlocks.filter((block) => block.id !== id));
  };

  // Validate condition has valid value
  const validateCondition = (condition: FilterCondition): string | null => {
    // Boolean types
    if (condition.type === 'auto_tag_exists' || condition.type === 'auto_tag_has_character') {
      if (typeof condition.value !== 'boolean') {
        return t('search:searchBar.validation.booleanRequired');
      }
    }
    // String types that require non-empty value
    else if (
      condition.type === 'auto_tag_general' ||
      condition.type === 'auto_tag_character' ||
      condition.type === 'prompt_contains' ||
      condition.type === 'prompt_regex' ||
      condition.type === 'negative_prompt_contains' ||
      condition.type === 'negative_prompt_regex' ||
      condition.type === 'ai_tool' ||
      condition.type === 'model_name' ||
      condition.type === 'auto_tag_model'
    ) {
      if (!condition.value || (typeof condition.value === 'string' && condition.value.trim() === '')) {
        return t('search:searchBar.validation.valueRequired');
      }
    }
    // Rating types
    else if (condition.type === 'auto_tag_rating' || condition.type === 'auto_tag_rating_score') {
      if (condition.min_score === undefined && condition.max_score === undefined) {
        return t('search:searchBar.validation.scoreRequired');
      }
    }

    return null;
  };

  // Search handlers
  const handleSearch = () => {
    setValidationError(null);

    if (activeTab === 0) {
      // Simple search mode
      if (!simpleSearchText.trim()) {
        setValidationError(t('search:searchBar.validation.searchTextRequired'));
        return;
      }

      const request: ComplexSearchRequest = {
        simple_search: {
          text: simpleSearchText.trim(),
        },
        page: 1,
        limit: 25,
      };

      onSearch(request);
    } else {
      // Advanced search mode
      if (filterBlocks.length === 0) {
        setValidationError(t('search:searchBar.validation.filterRequired'));
        return;
      }

      // Validate all conditions
      for (let i = 0; i < filterBlocks.length; i++) {
        const error = validateCondition(filterBlocks[i].condition);
        if (error) {
          setValidationError(t('search:searchBar.validation.filterError', { index: i + 1, error }));
          return;
        }
      }

      // 블록을 그룹별로 분리하여 API 요청 형식으로 변환
      const excludeConditions = filterBlocks
        .filter((block) => block.groupType === 'exclude')
        .map((block) => block.condition);

      const orConditions = filterBlocks
        .filter((block) => block.groupType === 'or')
        .map((block) => block.condition);

      const andConditions = filterBlocks
        .filter((block) => block.groupType === 'and')
        .map((block) => block.condition);

      const request: ComplexSearchRequest = {
        complex_filter: {
          exclude_group: excludeConditions.length > 0 ? excludeConditions : undefined,
          or_group: orConditions.length > 0 ? orConditions : undefined,
          and_group: andConditions.length > 0 ? andConditions : undefined,
        },
        page: 1,
        limit: 25,
      };

      onSearch(request);
    }
  };

  const handleClearSearch = () => {
    if (activeTab === 0) {
      setSimpleSearchText('');
    } else {
      setFilterBlocks([]);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  const hasConditions =
    activeTab === 0 ? simpleSearchText.trim().length > 0 : filterBlocks.length > 0;

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      {/* Validation Error Message */}
      {validationError && (
        <Box sx={{ mb: 2, p: 2, bgcolor: 'error.light', color: 'error.contrastText', borderRadius: 1 }}>
          <Typography variant="body2">{validationError}</Typography>
        </Box>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, newValue) => {
          setActiveTab(newValue);
          setValidationError(null);
        }}
        aria-label="search tabs"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label={t('search:searchBar.tabs.simple')} id="search-tab-0" aria-controls="search-tabpanel-0" />
        <Tab label={t('search:searchBar.tabs.advanced')} id="search-tab-1" aria-controls="search-tabpanel-1" />
      </Tabs>

      {/* Simple Search Tab */}
      <TabPanel value={activeTab} index={0}>
        <SimpleSearchTab
          searchText={simpleSearchText}
          onSearchTextChange={setSimpleSearchText}
          onKeyPress={handleKeyPress}
        />
      </TabPanel>

      {/* Advanced Search Tab */}
      <TabPanel value={activeTab} index={1}>
        <AdvancedSearchTab
          filterBlocks={filterBlocks}
          onAddBlock={handleAddBlock}
          onRemoveBlock={handleRemoveBlock}
          onEditBlock={handleEditBlock}
          showHeader={true}
        />
      </TabPanel>

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
    </Paper>
  );
};

export default SearchBar;
