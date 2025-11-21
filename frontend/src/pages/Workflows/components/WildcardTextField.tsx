import { useState, useEffect, useRef } from 'react';
import {
  TextField,
  Popper,
  Paper,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  Box,
  Tabs,
  Tab,
  IconButton,
  Chip,
  CircularProgress,
  InputAdornment
} from '@mui/material';
import {
  TextSnippet as TextIcon,
  ArrowBack as ArrowBackIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { wildcardApi } from '../../../services/api/wildcardApi';
import type { WildcardWithItems } from '../../../services/api/wildcardApi';

interface WildcardTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}

/**
 * 와일드카드 자동완성을 지원하는 텍스트 필드
 * "++" 입력 시 와일드카드 선택 팝업 표시
 */
export function WildcardTextField({
  value,
  onChange,
  label,
  required,
  placeholder,
  multiline = false,
  rows = 4
}: WildcardTextFieldProps) {
  const { t } = useTranslation(['wildcards']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);

  // 와일드카드 데이터
  const [wildcards, setWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [tabValue, setTabValue] = useState(0); // 0: 수동, 1: 자동(LORA)

  // 자동 와일드카드 계층 탐색용
  const [selectedTier, setSelectedTier] = useState<number | null>(null);

  // 와일드카드 로드
  useEffect(() => {
    const loadWildcards = async () => {
      setLoading(true);
      try {
        const response = await wildcardApi.getAllWildcards(false);
        if (response.success) {
          setWildcards(response.data);
        }
      } catch (error) {
        console.error('Failed to load wildcards:', error);
      } finally {
        setLoading(false);
      }
    };
    loadWildcards();
  }, []);

  // 계층 계산 함수
  const getWildcardTier = (id: number): number => {
    return Math.floor(id / 100000);
  };

  // 수동/자동 와일드카드 분리
  const manualWildcards = wildcards.filter(w => !(w as any).is_auto_collected);
  const autoWildcards = wildcards.filter(w => (w as any).is_auto_collected);

  // 자동 와일드카드의 사용 가능한 계층 목록
  const availableTiers = [...new Set(autoWildcards.map(w => getWildcardTier(w.id)))].sort((a, b) => a - b);

  // 필터링된 수동 와일드카드
  const filteredManualWildcards = manualWildcards.filter(w =>
    w.name.toLowerCase().includes(searchText.toLowerCase())
  );

  // 필터링된 자동 와일드카드 (계층 선택에 따라)
  const filteredAutoWildcards = autoWildcards.filter(w => {
    const tier = getWildcardTier(w.id);
    if (selectedTier !== null && tier !== selectedTier) return false;
    return w.name.toLowerCase().includes(searchText.toLowerCase());
  });

  // 입력 핸들러
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    onChange(newValue);
    setCursorPosition(cursorPos);

    // "++" 감지
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastPlusPlusIndex = textBeforeCursor.lastIndexOf('++');

    if (lastPlusPlusIndex !== -1) {
      const textAfterTrigger = textBeforeCursor.substring(lastPlusPlusIndex + 2);
      // 닫는 "++"가 없는 경우에만 팝업 표시
      if (!textAfterTrigger.includes('++')) {
        setTriggerStart(lastPlusPlusIndex);
        setSearchText(textAfterTrigger);
        setAnchorEl(e.target as HTMLElement);
        setIsOpen(true);
        return;
      }
    }

    setIsOpen(false);
    setTriggerStart(-1);
    setSearchText('');
  };

  // 와일드카드 선택
  const handleSelectWildcard = (wildcardName: string) => {
    if (triggerStart === -1) return;

    const before = value.substring(0, triggerStart);
    const after = value.substring(cursorPosition);
    const newValue = `${before}++${wildcardName}++${after}`;

    onChange(newValue);
    setIsOpen(false);
    setTriggerStart(-1);
    setSearchText('');
    setSelectedTier(null);

    // 포커스 복원
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = triggerStart + wildcardName.length + 4;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // 키보드 이벤트
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isOpen && e.key === 'Escape') {
      setIsOpen(false);
      setTriggerStart(-1);
      setSearchText('');
      setSelectedTier(null);
    }
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <TextField
        inputRef={inputRef}
        fullWidth
        multiline={multiline}
        rows={multiline ? rows : undefined}
        label={label}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        required={required}
        placeholder={placeholder}
        sx={{ mb: 2 }}
        helperText={t('wildcards:autocomplete.hint')}
      />

      <Popper
        open={isOpen}
        anchorEl={anchorEl}
        placement="bottom-start"
        style={{ zIndex: 1300, width: anchorEl?.clientWidth || 400 }}
      >
        <Paper
          elevation={8}
          sx={{
            maxHeight: 400,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* 탭 */}
          <Tabs
            value={tabValue}
            onChange={(_, v) => {
              setTabValue(v);
              setSelectedTier(null);
            }}
            variant="fullWidth"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label={t('wildcards:autocomplete.manualTab')} />
            <Tab label={t('wildcards:autocomplete.autoTab')} />
          </Tabs>

          {loading ? (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Box sx={{ overflow: 'auto', maxHeight: 320 }}>
              {/* 수동 와일드카드 탭 */}
              {tabValue === 0 && (
                <List dense>
                  {filteredManualWildcards.length === 0 ? (
                    <Typography sx={{ p: 2, color: 'text.secondary' }}>
                      {t('wildcards:autocomplete.noResults')}
                    </Typography>
                  ) : (
                    filteredManualWildcards.map(w => (
                      <ListItemButton
                        key={w.id}
                        onClick={() => handleSelectWildcard(w.name)}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <TextIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={w.name}
                          secondary={w.description}
                        />
                      </ListItemButton>
                    ))
                  )}
                </List>
              )}

              {/* 자동(LORA) 와일드카드 탭 */}
              {tabValue === 1 && (
                <>
                  {/* 계층 선택 칩 */}
                  {selectedTier === null && (
                    <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        {t('wildcards:autocomplete.selectTier')}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {availableTiers.map(tier => (
                          <Chip
                            key={tier}
                            label={`${t('wildcards:autoCollect.tierLabel', { tier })}`}
                            size="small"
                            onClick={() => setSelectedTier(tier)}
                            color="primary"
                            variant="outlined"
                            sx={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* 선택된 계층의 와일드카드 목록 */}
                  {selectedTier !== null && (
                    <>
                      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
                        <IconButton size="small" onClick={() => setSelectedTier(null)}>
                          <ArrowBackIcon fontSize="small" />
                        </IconButton>
                        <Chip
                          label={t('wildcards:autoCollect.tierLabel', { tier: selectedTier })}
                          size="small"
                          color="primary"
                        />
                        <Typography variant="body2" color="text.secondary">
                          ({filteredAutoWildcards.length})
                        </Typography>
                      </Box>

                      <List dense>
                        {filteredAutoWildcards.length === 0 ? (
                          <Typography sx={{ p: 2, color: 'text.secondary' }}>
                            {t('wildcards:autocomplete.noResults')}
                          </Typography>
                        ) : (
                          filteredAutoWildcards.map(w => (
                            <ListItemButton
                              key={w.id}
                              onClick={() => handleSelectWildcard(w.name)}
                            >
                              <ListItemIcon sx={{ minWidth: 36 }}>
                                <TextIcon fontSize="small" />
                              </ListItemIcon>
                              <ListItemText
                                primary={w.name}
                                secondary={w.description}
                              />
                            </ListItemButton>
                          ))
                        )}
                      </List>
                    </>
                  )}
                </>
              )}
            </Box>
          )}
        </Paper>
      </Popper>
    </Box>
  );
}
