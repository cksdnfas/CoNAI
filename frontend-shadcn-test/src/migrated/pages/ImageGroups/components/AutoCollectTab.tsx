import React, { useState, useEffect } from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { HelpOutline as HelpOutlineIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ComplexFilter, FilterCondition } from '@comfyui-image-manager/shared';
import SimpleSearchTab, { type SearchToken } from '../../../components/SearchBar/SimpleSearchTab';
import type { PromptSearchResult } from '../../../components/SearchBar/SearchAutoComplete';
import { promptCollectionApi } from '../../../services/api/promptApi';

interface AutoCollectTabProps {
  enabled: boolean;
  conditions: ComplexFilter;
  onEnabledChange: (enabled: boolean) => void;
  onConditionsChange: (conditions: ComplexFilter) => void;
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}) => {
  const { t } = useTranslation(['imageGroups', 'search']);

  // State
  const [searchText, setSearchText] = useState('');
  const [searchTokens, setSearchTokens] = useState<SearchToken[]>([]);

  // Initialize tokens from conditions on mount
  useEffect(() => {
    // Determine if we need to parse. Only parse if we have no tokens (initial load)
    // We can't easily detect "external updates" vs "internal updates" without refs,
    // but typically the modal keeps the state.
    // To be safe, we only parse if searchTokens is empty and conditions is not.
    // However, conditions might be empty initially.
    // Better approach: Parse once on mount.

    const tokens: SearchToken[] = [];

    const processCondition = (cond: FilterCondition, defaultLogic: 'OR' | 'AND' | 'NOT') => {
      let type: SearchToken['type'] = 'positive';
      let logic = defaultLogic;

      if (cond.category === 'auto_tag' || cond.type === 'auto_tag_any') {
        type = 'auto';
      } else if (cond.category === 'negative_prompt' || cond.type?.includes('negative')) {
        type = 'negative';
      }

      // If it looks like a text search (search text), we might want to put it in searchText?
      // But for stability, putting everything as tokens is safer for "edit" mode.

      const token: SearchToken = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        label: String(cond.value),
        value: String(cond.value),
        logic,
        minScore: cond.min_score,
        maxScore: cond.max_score,
      };
      tokens.push(token);
    };

    conditions.exclude_group?.forEach(c => processCondition(c, 'NOT'));
    conditions.or_group?.forEach(c => processCondition(c, 'OR'));
    conditions.and_group?.forEach(c => processCondition(c, 'AND'));

    // Prevent loop if already synced (simple check)
    // Actually, since we use 'conditions' from props which is updated by parent via onConditionsChange,
    // we need to be careful not to infinite loop.
    // But this component *drives* the change. The parent just holds state.
    // So if the parent state matches what we derived, we shouldn't update?
    // The issue is parent state `conditions` doesn't strictly map 1-to-1 to tokens (order might change etc).
    // So we should only initialize ONCE.
    // Since this is a Tab in a Modal, it mounts once when the tab is shown (or when modal opens if not unmounted).
    // The `GroupCreateEditModal` keeps the tab mounted? No, TabPanel hides it.
    // Let's assume mount is fresh.
    if (tokens.length > 0) {
      setSearchTokens(tokens);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Update parent when tokens or text change
  useEffect(() => {
    const excludeGroup: FilterCondition[] = [];
    const orGroup: FilterCondition[] = [];
    const andGroup: FilterCondition[] = [];

    const tokensToProcess = [...searchTokens];
    if (searchText.trim()) {
      tokensToProcess.push({
        id: 'temp-text',
        type: 'positive',
        label: searchText.trim(),
        value: searchText.trim(),
        logic: 'OR',
      });
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

    const newConditions: ComplexFilter = {
      exclude_group: excludeGroup.length > 0 ? excludeGroup : undefined,
      or_group: orGroup.length > 0 ? orGroup : undefined,
      and_group: andGroup.length > 0 ? andGroup : undefined,
    };

    // Only call update if actually changed to avoid cycles if parent updates props back?
    // Actually, in `GroupCreateEditModal`, `handleConditionsChange` just sets state.
    // It passes `conditions` back down.
    // If we update effectively same content, it's fine.
    onConditionsChange(newConditions);

  }, [searchTokens, searchText, onConditionsChange]);

  // Handlers
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
      count: tag.usage_count
    };
    setSearchTokens([...searchTokens, newToken]);
    setSearchText('');
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

  const handleUpdateToken = (id: string, updates: Partial<SearchToken>) => {
    setSearchTokens(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

    // Async update count if type changed
    if (updates.type) {
      // Skip for rating type
      if (updates.type === 'rating') return;

      const token = searchTokens.find(t => t.id === id);
      if (token) {
        const newType = updates.type;
        const query = token.value;
        (async () => {
          try {
            const apiType = newType === 'auto' ? 'auto' : newType;
            const res = await promptCollectionApi.searchPrompts(query, apiType, 1, 10);
            const results = (res as any).data || (res as any).prompts;
            if (Array.isArray(results)) {
              const match = results.find((p: any) => p.prompt === query);
              if (match) {
                setSearchTokens(current => current.map(t =>
                  t.id === id ? { ...t, count: match.usage_count } : t
                ));
              }
            }
          } catch (e) {
            console.error('Failed to update token count', e);
          }
        })();
      }
    }
  };

  const handleHelpClick = () => {
    window.open('/help?page=filters#/help', '_blank');
  };

  // filterCount for display
  const filterCount = enabled
    ? (conditions.exclude_group?.length || 0) +
    (conditions.or_group?.length || 0) +
    (conditions.and_group?.length || 0)
    : 0;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              color="primary"
            />
          }
          label={
            <Typography variant="subtitle1" fontWeight={500}>
              {t('imageGroups:modal.autoCollectEnable')}
            </Typography>
          }
        />
      </Box>

      {enabled && (
        <Box>
          <SimpleSearchTab
            searchText={searchText}
            onSearchTextChange={setSearchText}
            onSearch={() => { /* No-op or we could add text as token */ }}
            tokens={searchTokens}
            onAddToken={handleAddToken}
            onRemoveToken={handleRemoveToken}
            onCycleLogic={handleCycleLogic}
            onUpdateToken={handleUpdateToken}
          />
        </Box>
      )}

      {!enabled && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('imageGroups:modal.autoCollectDisabledHelp')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AutoCollectTab;
