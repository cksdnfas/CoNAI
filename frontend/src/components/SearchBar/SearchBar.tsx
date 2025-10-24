import React, { useState } from 'react';
import {
  Box,
  Paper,
  Tabs,
  Tab,
  Button,
  Stack,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { FilterCondition, ComplexSearchRequest } from '@comfyui-image-manager/shared';
import SimpleSearchTab from './SimpleSearchTab';
import AdvancedSearchTab from './AdvancedSearchTab';

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
  // Tab state
  const [activeTab, setActiveTab] = useState(0); // 0: Simple, 1: Advanced

  // Simple search state
  const [simpleSearchText, setSimpleSearchText] = useState('');

  // Advanced search state - Filter groups
  const [excludeConditions, setExcludeConditions] = useState<FilterCondition[]>([]);
  const [orConditions, setOrConditions] = useState<FilterCondition[]>([]);
  const [andConditions, setAndConditions] = useState<FilterCondition[]>([]);

  // Default empty condition template
  const createEmptyCondition = (): FilterCondition => ({
    category: 'auto_tag',
    type: 'auto_tag_general',
    value: '',
  });

  // Exclude group handlers
  const handleAddExcludeCondition = () => {
    setExcludeConditions([...excludeConditions, createEmptyCondition()]);
  };

  const handleUpdateExcludeCondition = (index: number, condition: FilterCondition) => {
    const updated = [...excludeConditions];
    updated[index] = condition;
    setExcludeConditions(updated);
  };

  const handleRemoveExcludeCondition = (index: number) => {
    setExcludeConditions(excludeConditions.filter((_, i) => i !== index));
  };

  // OR group handlers
  const handleAddOrCondition = () => {
    setOrConditions([...orConditions, createEmptyCondition()]);
  };

  const handleUpdateOrCondition = (index: number, condition: FilterCondition) => {
    const updated = [...orConditions];
    updated[index] = condition;
    setOrConditions(updated);
  };

  const handleRemoveOrCondition = (index: number) => {
    setOrConditions(orConditions.filter((_, i) => i !== index));
  };

  // AND group handlers
  const handleAddAndCondition = () => {
    setAndConditions([...andConditions, createEmptyCondition()]);
  };

  const handleUpdateAndCondition = (index: number, condition: FilterCondition) => {
    const updated = [...andConditions];
    updated[index] = condition;
    setAndConditions(updated);
  };

  const handleRemoveAndCondition = (index: number) => {
    setAndConditions(andConditions.filter((_, i) => i !== index));
  };

  // Search handlers
  const handleSearch = () => {
    if (activeTab === 0) {
      // Simple search mode
      if (!simpleSearchText.trim()) {
        return; // Don't search with empty text
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
      const totalConditions =
        excludeConditions.length + orConditions.length + andConditions.length;

      if (totalConditions === 0) {
        return; // Don't search without any conditions
      }

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
      setExcludeConditions([]);
      setOrConditions([]);
      setAndConditions([]);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  const hasConditions =
    activeTab === 0
      ? simpleSearchText.trim().length > 0
      : excludeConditions.length + orConditions.length + andConditions.length > 0;

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, newValue) => setActiveTab(newValue)}
        aria-label="search tabs"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="일반 검색" id="search-tab-0" aria-controls="search-tabpanel-0" />
        <Tab label="고급 검색" id="search-tab-1" aria-controls="search-tabpanel-1" />
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
          excludeConditions={excludeConditions}
          orConditions={orConditions}
          andConditions={andConditions}
          onAddExcludeCondition={handleAddExcludeCondition}
          onUpdateExcludeCondition={handleUpdateExcludeCondition}
          onRemoveExcludeCondition={handleRemoveExcludeCondition}
          onAddOrCondition={handleAddOrCondition}
          onUpdateOrCondition={handleUpdateOrCondition}
          onRemoveOrCondition={handleRemoveOrCondition}
          onAddAndCondition={handleAddAndCondition}
          onUpdateAndCondition={handleUpdateAndCondition}
          onRemoveAndCondition={handleRemoveAndCondition}
        />
      </TabPanel>

      {/* Action Buttons */}
      <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<SearchIcon />}
          onClick={handleSearch}
          disabled={loading || !hasConditions}
          fullWidth
        >
          {loading ? '검색 중...' : '검색'}
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<ClearIcon />}
          onClick={handleClearSearch}
          disabled={loading || !hasConditions}
        >
          초기화
        </Button>
      </Stack>
    </Paper>
  );
};

export default SearchBar;
