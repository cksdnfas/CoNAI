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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['search']);

  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('search:simpleSearch.description')}
        </Typography>
        <Tooltip
          title={
            <Stack spacing={0.5}>
              <Typography variant="caption">• {t('search:simpleSearch.helpTooltip.searchScope')}</Typography>
              <Typography variant="caption">• {t('search:simpleSearch.helpTooltip.ignoreWeights')}</Typography>
              <Typography variant="caption">• {t('search:simpleSearch.helpTooltip.advancedTip')}</Typography>
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
        placeholder={t('search:simpleSearch.placeholder')}
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
