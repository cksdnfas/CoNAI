import React from 'react';
import {
  Box,
  Typography,
  Stack,
  Tooltip,
  IconButton,
  Paper,
  Popover,
  Slider
} from '@mui/material';
import {
  HelpOutline as HelpIcon,
  CallMerge as AndIcon,
  DoNotDisturb as NotIcon,
  CallSplit as OrIcon,
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  Block as BlockIcon,
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';
import SearchAutoComplete, { type PromptSearchResult } from './SearchAutoComplete';
import { useTranslation } from 'react-i18next';

export interface SearchToken {
  id: string;
  type: 'positive' | 'negative' | 'auto';
  label: string;
  value: string;
  logic: 'OR' | 'AND' | 'NOT';
  count?: number;
  minScore?: number;
  maxScore?: number;
}

interface SimpleSearchTabProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  onSearch: () => void;
  tokens: SearchToken[];
  onAddToken: (tag: PromptSearchResult) => void;
  onRemoveToken: (id: string) => void;
  onCycleLogic: (id: string) => void;
  onUpdateToken: (id: string, updates: Partial<SearchToken>) => void;
}

const SimpleSearchTab: React.FC<SimpleSearchTabProps> = ({
  searchText,
  onSearchTextChange,
  onSearch,
  tokens,
  onAddToken,
  onRemoveToken,
  onCycleLogic,
  onUpdateToken
}) => {
  const { t } = useTranslation(['search']);



  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      onSearch();
    }
  };

  return (
    <Box sx={{ py: 2 }}>


      <SearchAutoComplete
        value={searchText}
        onChange={onSearchTextChange}
        onSelectTag={onAddToken}
        onKeyPress={handleKeyPress}
        placeholder={t('search:simpleSearch.placeholder')}
      />

      {/* Token List */}
      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }} useFlexGap>
        {tokens.map(token => (
          <TokenBadge
            key={token.id}
            token={token}
            onRemove={onRemoveToken}
            onCycleLogic={onCycleLogic}
            onUpdate={onUpdateToken}
          />
        ))}
      </Stack>
    </Box>
  );
};

// Extracted Token Badge Component for cleaner logic
const TokenBadge: React.FC<{
  token: SearchToken;
  onRemove: (id: string) => void;
  onCycleLogic: (id: string) => void;
  onUpdate: (id: string, updates: Partial<SearchToken>) => void;
}> = ({ token, onRemove, onCycleLogic, onUpdate }) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLDivElement | null>(null);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only open slider for auto tags
    if (token.type === 'auto') {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleCycleType = (e: React.MouseEvent) => {
    e.stopPropagation();
    const types: SearchToken['type'][] = ['positive', 'negative', 'auto'];
    const currentIndex = types.indexOf(token.type);
    const nextType = types[(currentIndex + 1) % types.length];
    // Count is specific to the original classification, so we hide it when type changes
    onUpdate(token.id, { type: nextType, count: undefined });
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const getLogicIcon = (logic: 'OR' | 'AND' | 'NOT') => {
    switch (logic) {
      case 'OR': return <OrIcon fontSize="small" />;
      case 'AND': return <AndIcon fontSize="small" />;
      case 'NOT': return <NotIcon fontSize="small" />;
    }
  };

  const getLogicColor = (logic: 'OR' | 'AND' | 'NOT') => {
    switch (logic) {
      case 'OR': return 'info';
      case 'AND': return 'success';
      case 'NOT': return 'error';
    }
  };

  const getTypeColor = (type: SearchToken['type']) => {
    switch (type) {
      case 'positive': return 'success';
      case 'negative': return 'error';
      case 'auto': return 'warning';
    }
  };

  const getSourceIcon = (type: SearchToken['type']) => {
    switch (type) {
      case 'positive': return <CheckCircleIcon fontSize="small" color="inherit" />;
      case 'negative': return <BlockIcon fontSize="small" color="inherit" />;
      case 'auto': return <AutoAwesomeIcon fontSize="small" color="inherit" />;
    }
  };

  const open = Boolean(anchorEl);

  // Score display logic
  const minScore = token.minScore ?? 0;
  const maxScore = token.maxScore ?? 1;
  const showScore = token.type === 'auto';

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper'
        }}
      >
        {/* Logic Toggle */}
        <Box
          onClick={(e) => {
            e.stopPropagation();
            onCycleLogic(token.id);
          }}
          sx={{
            p: 1,
            bgcolor: `${getLogicColor(token.logic)}.main`,
            color: `${getLogicColor(token.logic)}.contrastText`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            '&:hover': { opacity: 0.9 }
          }}
        >
          {getLogicIcon(token.logic)}
        </Box>

        {/* Type Toggle */}
        <Box
          onClick={handleCycleType}
          sx={{
            p: 1,
            bgcolor: `${getTypeColor(token.type)}.main`,
            color: `${getTypeColor(token.type)}.contrastText`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            '&:hover': { opacity: 0.9 }
          }}
        >
          {getSourceIcon(token.type)}
        </Box>

        {/* Label (and Slider trigger for auto tags) */}
        <Box
          onClick={handleClick}
          sx={{
            px: 1.5,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            cursor: token.type === 'auto' ? 'pointer' : 'default',
            '&:hover': token.type === 'auto' ? { bgcolor: 'action.hover' } : {}
          }}
        >
          <Typography variant="body2">{token.label}</Typography>

          {token.count !== undefined && token.count > 0 && (
            <Typography variant="caption" color="text.secondary">({token.count})</Typography>
          )}

          {showScore && (
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
              ({minScore.toFixed(1)}~{maxScore.toFixed(1)})
            </Typography>
          )}
        </Box>

        <IconButton size="small" onClick={() => onRemove(token.id)} sx={{ mr: 0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <Box sx={{ p: 2, width: 250 }}>
          <Typography variant="subtitle2" gutterBottom>
            Confidence Score Range
          </Typography>
          <Slider
            value={[minScore, maxScore]}
            onChange={(_: Event, newValue: number | number[]) => {
              const [min, max] = newValue as number[];
              onUpdate(token.id, { minScore: min, maxScore: max });
            }}
            valueLabelDisplay="auto"
            min={0}
            max={1}
            step={0.1}
            marks
            size="small"
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Typography variant="caption">{minScore.toFixed(1)}</Typography>
            <Typography variant="caption">{maxScore.toFixed(1)}</Typography>
          </Box>
        </Box>
      </Popover>
    </>
  );
};

export default SimpleSearchTab;
