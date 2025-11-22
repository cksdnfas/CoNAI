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
  InputAdornment,
  ClickAwayListener,
  type TextFieldProps
} from '@mui/material';
import {
  TextSnippet as TextIcon,
  ArrowBack as ArrowBackIcon,
  Search as SearchIcon,
  ChevronRight as ChevronRightIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Close as CloseIcon,
  AutoAwesome as AutoIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { wildcardApi } from '../../services/api/wildcardApi';
import type { WildcardWithItems, WildcardWithHierarchy } from '../../services/api/wildcardApi';

interface WildcardTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
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
  rows = 4,
  disabled = false
}: WildcardTextFieldProps) {
  const { t } = useTranslation(['wildcards']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [triggerStart, setTriggerStart] = useState(-1);

  // 와일드카드 데이터
  const [hierarchicalWildcards, setHierarchicalWildcards] = useState<WildcardWithHierarchy[]>([]);
  const [flatWildcards, setFlatWildcards] = useState<WildcardWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [tabValue, setTabValue] = useState(0); // 0: 수동, 1: 자동(LORA)

  // 수동 와일드카드 계층 탐색용
  const [currentPath, setCurrentPath] = useState<WildcardWithHierarchy[]>([]); // Breadcrumb path
  const [currentChildren, setCurrentChildren] = useState<WildcardWithHierarchy[]>([]);

  // 자동 와일드카드 계층 탐색용
  const [selectedTier, setSelectedTier] = useState<number | null>(null);

  // 와일드카드 로드
  useEffect(() => {
    const loadWildcards = async () => {
      setLoading(true);
      try {
        // 계층 구조로 로드
        const hierarchicalResponse = await wildcardApi.getWildcardsHierarchical();
        if (hierarchicalResponse.success) {
          setHierarchicalWildcards(hierarchicalResponse.data);
          // 수동 와일드카드만 초기 children으로 설정
          const manualOnly = hierarchicalResponse.data.filter(w => !(w as any).is_auto_collected);
          setCurrentChildren(manualOnly);
        }

        // 평면 리스트로도 로드 (자동 수집 와일드카드용)
        const flatResponse = await wildcardApi.getAllWildcards(false);
        if (flatResponse.success) {
          setFlatWildcards(flatResponse.data);
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

  // 자동 와일드카드 분리
  const autoWildcards = flatWildcards.filter(w => (w as any).is_auto_collected);

  // 자동 와일드카드의 사용 가능한 계층 목록
  const availableTiers = [...new Set(autoWildcards.map(w => getWildcardTier(w.id)))].sort((a, b) => a - b);

  // 필터링된 자동 와일드카드 (계층 선택에 따라)
  const filteredAutoWildcards = autoWildcards.filter(w => {
    const tier = getWildcardTier(w.id);
    if (selectedTier !== null && tier !== selectedTier) return false;
    return w.name.toLowerCase().includes(searchText.toLowerCase());
  });

  // 계층 구조를 평면화하는 함수
  const flattenHierarchy = (items: WildcardWithHierarchy[]): WildcardWithHierarchy[] => {
    const result: WildcardWithHierarchy[] = [];
    const flatten = (nodes: WildcardWithHierarchy[]) => {
      nodes.forEach(node => {
        result.push(node);
        if (node.children && node.children.length > 0) {
          flatten(node.children);
        }
      });
    };
    flatten(items);
    return result;
  };

  // 수동 와일드카드만 필터링
  const manualHierarchicalWildcards = hierarchicalWildcards.filter(w => !(w as any).is_auto_collected);

  // 자동 와일드카드 계층 구조 (LORA)
  const autoHierarchicalWildcards = hierarchicalWildcards.filter(w => (w as any).is_auto_collected);

  // 현재 표시할 항목들
  // 검색어가 있으면 전체 계층에서 검색, 없으면 현재 폴더의 children만 표시
  const baseHierarchy = tabValue === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards;

  const displayItems = searchText
    ? flattenHierarchy(baseHierarchy).filter(w =>
        w.name.toLowerCase().includes(searchText.toLowerCase())
      )
    : currentChildren;

  // 폴더로 이동
  const navigateToFolder = (item: WildcardWithHierarchy) => {
    setCurrentPath([...currentPath, item]);
    setCurrentChildren(item.children || []);
    setSearchText(''); // 검색어 초기화
  };

  // 상위 폴더로 이동
  const navigateBack = () => {
    if (currentPath.length === 0) return;

    const newPath = [...currentPath];
    newPath.pop();
    setCurrentPath(newPath);

    if (newPath.length === 0) {
      // 루트로 돌아감 (현재 탭에 맞게)
      setCurrentChildren(
        tabValue === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards
      );
    } else {
      // 이전 폴더로
      const parent = newPath[newPath.length - 1];
      setCurrentChildren(parent.children || []);
    }
    setSearchText(''); // 검색어 초기화
  };

  // Breadcrumb 특정 위치로 이동
  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      // 루트로 (현재 탭에 맞게)
      setCurrentPath([]);
      setCurrentChildren(
        tabValue === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards
      );
    } else {
      const newPath = currentPath.slice(0, index + 1);
      setCurrentPath(newPath);
      const target = newPath[newPath.length - 1];
      setCurrentChildren(target.children || []);
    }
    setSearchText('');
  };

  // 입력 핸들러
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    onChange(newValue);
    setCursorPosition(cursorPos);

    // "++" 감지: 커서 이전의 텍스트에서 마지막 ++를 찾음
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastPlusPlusIndex = textBeforeCursor.lastIndexOf('++');

    if (lastPlusPlusIndex !== -1) {
      // ++ 이후부터 커서까지의 텍스트
      const textAfterTrigger = textBeforeCursor.substring(lastPlusPlusIndex + 2);

      // 닫는 "++"가 없고, 와일드카드 완성되지 않은 경우에만 팝업 표시
      // 예: "++name" (O), "++" (O), "++name++" (X - 완성됨)
      const hasClosingPlusPlus = textAfterTrigger.includes('++');

      if (!hasClosingPlusPlus) {
        // ++ 앞의 문자를 확인: 시작이거나 "," 또는 ", " 인 경우만 모달 열기
        const charBeforePlusPlus = lastPlusPlusIndex > 0
          ? textBeforeCursor.substring(lastPlusPlusIndex - 2, lastPlusPlusIndex)
          : '';

        const isValidTrigger =
          lastPlusPlusIndex === 0 || // 시작 위치
          charBeforePlusPlus === ', ' || // ", ++"
          charBeforePlusPlus.endsWith(','); // ",++"

        if (isValidTrigger) {
          setTriggerStart(lastPlusPlusIndex);
          setSearchText(textAfterTrigger);
          setAnchorEl(e.target as HTMLElement);
          setIsOpen(true);
          return;
        }
      }
    }

    // 유효한 트리거가 아닌 경우 모달 닫기
    setIsOpen(false);
    setTriggerStart(-1);
    setSearchText('');
  };

  // 와일드카드 선택 (현재 수정중인 와일드카드만 변경, 모달은 열어둠)
  const handleSelectWildcard = (wildcardName: string) => {
    if (triggerStart === -1) return;

    const before = value.substring(0, triggerStart);
    const after = value.substring(cursorPosition);
    // 완성된 와일드카드로 교체 (닫지 않음)
    const newValue = `${before}++${wildcardName}++${after}`;

    onChange(newValue);

    // 커서를 ++name++ 끝으로 이동
    const newCursorPos = triggerStart + wildcardName.length + 4; // ++name++
    const newTriggerStart = triggerStart; // triggerStart 위치 유지

    setCursorPosition(newCursorPos);
    // triggerStart를 완성된 와일드카드 시작 위치로 업데이트
    // 이렇게 하면 다음 입력시 올바르게 감지됨
    setTriggerStart(newTriggerStart);

    // 검색어만 초기화 (네비게이션 상태는 유지)
    setSearchText('');

    // 포커스 복원 및 커서 위치 설정
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // 다음 와일드카드 추가 (+ 버튼: 현재 와일드카드 유지하고 다음 추가)
  const handleAddNext = () => {
    // 현재 완성된 와일드카드가 있어야 함
    const before = value.substring(0, cursorPosition);
    const after = value.substring(cursorPosition);
    // ", ++" 추가하여 다음 와일드카드 입력 준비
    const newValue = `${before}, ++${after}`;

    onChange(newValue);

    const newCursorPos = cursorPosition + 4; // ", ++"
    const newTriggerStart = cursorPosition + 2; // 새로운 ++ 시작 위치

    // 상태 업데이트 (모달은 열어둠)
    setCursorPosition(newCursorPos);
    setTriggerStart(newTriggerStart);
    setSearchText('');
    setCurrentPath([]);
    setCurrentChildren(
      tabValue === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards
    );

    // 포커스 복원
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // 팝업 닫기
  const handleClose = () => {
    // 미완성 와일드카드만 제거
    if (triggerStart !== -1) {
      // triggerStart부터 cursorPosition까지의 텍스트 확인
      const between = value.substring(triggerStart, cursorPosition);

      // 미완성 와일드카드인지 확인: ++로 시작하고 ++로 끝나지 않는 경우만
      const isIncomplete = between.startsWith('++') && !between.endsWith('++');

      if (isIncomplete) {
        // 미완성 와일드카드만 제거
        const before = value.substring(0, triggerStart);
        const after = value.substring(cursorPosition);
        const newValue = before + after;
        onChange(newValue);

        // 커서 위치 조정
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(triggerStart, triggerStart);
          }
        }, 0);
      }
    }

    setIsOpen(false);
    setTriggerStart(-1);
    setSearchText('');
    setSelectedTier(null);
    setCurrentPath([]);
    // 현재 탭에 맞는 계층으로 복원
    setCurrentChildren(
      tabValue === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards
    );
  };

  // 키보드 이벤트
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isOpen && e.key === 'Escape') {
      handleClose();
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
        disabled={disabled}
      />

      <Popper
        open={isOpen}
        anchorEl={anchorEl}
        placement="bottom-start"
        style={{ zIndex: 1300, width: anchorEl?.clientWidth || 400 }}
      >
        <ClickAwayListener onClickAway={handleClose}>
          <Paper
          elevation={8}
          sx={{
            maxHeight: 400,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            border: 2,
            borderColor: 'primary.main',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(0, 0, 0, 0.9)'
                : 'background.paper'
          }}
        >
          {/* 헤더: 탭 + 추가/닫기 버튼 */}
          <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={tabValue}
              onChange={(_, v) => {
                setTabValue(v);
                setSelectedTier(null);
                setCurrentPath([]);
                // 탭에 따라 적절한 계층 구조 설정
                setCurrentChildren(
                  v === 0 ? manualHierarchicalWildcards : autoHierarchicalWildcards
                );
                setSearchText('');
              }}
              sx={{ flex: 1 }}
            >
              <Tab label={t('wildcards:autocomplete.manualTab')} />
              <Tab label={t('wildcards:autocomplete.autoTab')} />
            </Tabs>
            <IconButton
              size="small"
              onClick={handleAddNext}
              sx={{ mr: 0.5 }}
              color="primary"
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={handleClose}
              sx={{ mr: 1 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {loading ? (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Box sx={{ overflow: 'auto', maxHeight: 320 }}>
              {/* 수동 와일드카드 탭 */}
              {tabValue === 0 && (
                <>
                  {/* Breadcrumb 네비게이션 */}
                  <Box sx={{
                    p: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                    flexWrap: 'wrap'
                  }}>
                    {/* 뒤로가기 버튼 */}
                    {currentPath.length > 0 && (
                      <IconButton size="small" onClick={navigateBack}>
                        <ArrowBackIcon fontSize="small" />
                      </IconButton>
                    )}

                    {/* 루트 */}
                    <Chip
                      label={t('wildcards:autocomplete.root', { defaultValue: 'Root' })}
                      size="small"
                      onClick={() => navigateToBreadcrumb(-1)}
                      color={currentPath.length === 0 ? 'primary' : 'default'}
                      sx={{ cursor: 'pointer' }}
                    />

                    {/* 경로 */}
                    {currentPath.map((pathItem, index) => (
                      <Box key={pathItem.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <ChevronRightIcon fontSize="small" color="action" />
                        <Chip
                          label={pathItem.name}
                          size="small"
                          onClick={() => navigateToBreadcrumb(index)}
                          color={index === currentPath.length - 1 ? 'primary' : 'default'}
                          sx={{ cursor: 'pointer' }}
                        />
                      </Box>
                    ))}
                  </Box>

                  {/* 와일드카드 목록 */}
                  <List dense>
                    {displayItems.length === 0 ? (
                      <Typography sx={{ p: 2, color: 'text.secondary' }}>
                        {t('wildcards:autocomplete.noResults')}
                      </Typography>
                    ) : (
                      displayItems.map(w => {
                        const hasChildren = w.children && w.children.length > 0;
                        return (
                          <ListItemButton
                            key={w.id}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              '&:hover .navigate-icon': {
                                opacity: 1
                              },
                              '&:hover': {
                                bgcolor: 'rgba(25, 118, 210, 0.08)'
                              }
                            }}
                          >
                            {/* 아이콘 */}
                            <ListItemIcon sx={{ minWidth: 36 }}>
                              {hasChildren ? (
                                <FolderIcon fontSize="small" color="primary" />
                              ) : (
                                <TextIcon fontSize="small" color="action" />
                              )}
                            </ListItemIcon>

                            {/* 이름 - 클릭하면 선택 */}
                            <ListItemText
                              primary={w.name}
                              secondary={w.description}
                              onClick={() => handleSelectWildcard(w.name)}
                              sx={{ cursor: 'pointer', flex: 1 }}
                            />

                            {/* 하위 항목으로 이동 버튼 */}
                            {hasChildren && (
                              <IconButton
                                size="small"
                                className="navigate-icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigateToFolder(w);
                                }}
                                sx={{
                                  opacity: 0.5,
                                  transition: 'opacity 0.2s'
                                }}
                              >
                                <ChevronRightIcon fontSize="small" />
                              </IconButton>
                            )}
                          </ListItemButton>
                        );
                      })
                    )}
                  </List>
                </>
              )}

              {/* 자동(LORA) 와일드카드 탭 */}
              {tabValue === 1 && (
                <>
                  {/* Breadcrumb 네비게이션 (자동 탭도 동일) */}
                  <Box sx={{
                    p: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                    flexWrap: 'wrap'
                  }}>
                    {/* 뒤로가기 버튼 */}
                    {currentPath.length > 0 && (
                      <IconButton size="small" onClick={navigateBack}>
                        <ArrowBackIcon fontSize="small" />
                      </IconButton>
                    )}

                    {/* 루트 */}
                    <Chip
                      label={t('wildcards:autocomplete.root', { defaultValue: 'Root' })}
                      size="small"
                      onClick={() => navigateToBreadcrumb(-1)}
                      color={currentPath.length === 0 ? 'secondary' : 'default'}
                      sx={{ cursor: 'pointer' }}
                    />

                    {/* 경로 */}
                    {currentPath.map((pathItem, index) => (
                      <Box key={pathItem.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <ChevronRightIcon fontSize="small" color="action" />
                        <Chip
                          label={pathItem.name}
                          size="small"
                          onClick={() => navigateToBreadcrumb(index)}
                          color={index === currentPath.length - 1 ? 'secondary' : 'default'}
                          sx={{ cursor: 'pointer' }}
                        />
                      </Box>
                    ))}
                  </Box>

                  {/* 와일드카드 목록 */}
                  <List dense>
                    {displayItems.length === 0 ? (
                      <Typography sx={{ p: 2, color: 'text.secondary' }}>
                        {t('wildcards:autocomplete.noResults')}
                      </Typography>
                    ) : (
                      displayItems.map(w => {
                        const hasChildren = w.children && w.children.length > 0;
                        return (
                          <ListItemButton
                            key={w.id}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              '&:hover .navigate-icon': {
                                opacity: 1
                              },
                              '&:hover': {
                                bgcolor: 'rgba(156, 39, 176, 0.08)'
                              }
                            }}
                          >
                            {/* 아이콘 */}
                            <ListItemIcon sx={{ minWidth: 36 }}>
                              {hasChildren ? (
                                <FolderIcon fontSize="small" color="secondary" />
                              ) : (
                                <AutoIcon fontSize="small" sx={{ color: 'secondary.main' }} />
                              )}
                            </ListItemIcon>

                            {/* 이름 - 클릭하면 선택 */}
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <span>{w.name}</span>
                                  <Chip
                                    label={t('wildcards:autoCollect.autoCollectedBadge', { defaultValue: 'Auto' })}
                                    size="small"
                                    color="secondary"
                                    sx={{ height: 16, fontSize: '0.6rem' }}
                                  />
                                </Box>
                              }
                              secondary={w.description}
                              onClick={() => handleSelectWildcard(w.name)}
                              sx={{ cursor: 'pointer', flex: 1 }}
                            />

                            {/* 하위 항목으로 이동 버튼 */}
                            {hasChildren && (
                              <IconButton
                                size="small"
                                className="navigate-icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigateToFolder(w);
                                }}
                                sx={{
                                  opacity: 0.5,
                                  transition: 'opacity 0.2s'
                                }}
                              >
                                <ChevronRightIcon fontSize="small" />
                              </IconButton>
                            )}
                          </ListItemButton>
                        );
                      })
                    )}
                  </List>
                </>
              )}
            </Box>
          )}
        </Paper>
        </ClickAwayListener>
      </Popper>
    </Box>
  );
}
