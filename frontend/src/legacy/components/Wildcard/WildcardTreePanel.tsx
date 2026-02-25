import { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  List,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  TextField,
  InputAdornment,
  IconButton
} from '@mui/material';
import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
  Search as SearchIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { WildcardTreeNode } from './WildcardTreeNode';
import type { WildcardWithHierarchy } from '../../services/api/wildcardApi';

interface WildcardTreePanelProps {
  data: WildcardWithHierarchy[];
  selectedId: number | null;
  expandedIds: Set<number>;
  onSelect: (node: WildcardWithHierarchy) => void;
  onToggle: (id: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  sortChildren?: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number;
  emptyMessage?: string;
}

/**
 * 노드와 그 자식들 중 검색어와 일치하는 항목이 있는지 확인
 */
function nodeMatchesSearch(node: WildcardWithHierarchy, searchTerm: string): boolean {
  const lowerSearch = searchTerm.toLowerCase();

  // 현재 노드의 이름이 검색어와 일치하는지 확인
  if (node.name.toLowerCase().includes(lowerSearch)) {
    return true;
  }

  // 자식 노드들 중 일치하는 항목이 있는지 재귀적으로 확인
  if (node.children && node.children.length > 0) {
    return node.children.some(child => nodeMatchesSearch(child, searchTerm));
  }

  return false;
}

/**
 * 검색어에 맞게 트리를 필터링하고, 일치하는 노드의 부모들을 포함
 */
function filterTree(nodes: WildcardWithHierarchy[], searchTerm: string): WildcardWithHierarchy[] {
  if (!searchTerm.trim()) {
    return nodes;
  }

  return nodes.filter(node => nodeMatchesSearch(node, searchTerm)).map(node => {
    // 자식 노드들도 필터링
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: filterTree(node.children, searchTerm)
      };
    }
    return node;
  });
}

/**
 * 검색 결과에서 일치하는 노드들의 부모 ID를 수집
 */
function collectMatchingParentIds(nodes: WildcardWithHierarchy[], searchTerm: string, parentIds: Set<number> = new Set()): Set<number> {
  const lowerSearch = searchTerm.toLowerCase();

  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      // 자식 중 검색어와 일치하는 항목이 있으면 현재 노드의 ID를 추가
      const hasMatchingChild = node.children.some(child => nodeMatchesSearch(child, searchTerm));
      if (hasMatchingChild || node.name.toLowerCase().includes(lowerSearch)) {
        parentIds.add(node.id);
      }
      // 재귀적으로 자식들도 확인
      collectMatchingParentIds(node.children, searchTerm, parentIds);
    }
  }

  return parentIds;
}

/**
 * 와일드카드 트리 뷰를 표시하는 좌측 패널 컴포넌트
 * 확장/축소 컨트롤과 트리 리스트 포함
 */
export function WildcardTreePanel({
  data,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onExpandAll,
  onCollapseAll,
  sortChildren,
  emptyMessage
}: WildcardTreePanelProps) {
  const { t } = useTranslation(['wildcards', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // 검색어 상태
  const [searchTerm, setSearchTerm] = useState('');

  // 검색어로 필터링된 트리 데이터
  const filteredData = useMemo(() => {
    return filterTree(data, searchTerm);
  }, [data, searchTerm]);

  // 검색 시 자동으로 확장할 노드 ID들
  const searchExpandedIds = useMemo(() => {
    if (!searchTerm.trim()) {
      return new Set<number>();
    }
    return collectMatchingParentIds(data, searchTerm);
  }, [data, searchTerm]);

  // 검색 중일 때는 검색 결과에 맞는 확장 상태 사용
  const effectiveExpandedIds = useMemo(() => {
    if (searchTerm.trim()) {
      return new Set([...expandedIds, ...searchExpandedIds]);
    }
    return expandedIds;
  }, [expandedIds, searchExpandedIds, searchTerm]);

  // 검색어 지우기
  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  // 루트 레벨 정렬
  const sortedRootNodes = sortChildren ? [...filteredData].sort(sortChildren) : filteredData;

  return (
    <Paper
      variant="outlined"
      sx={{
        width: isMobile ? '100%' : 280,
        minWidth: isMobile ? 'auto' : 280,
        minHeight: isMobile ? 200 : 400,
        maxHeight: isMobile ? 300 : '70vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Tree Controls */}
      {data.length > 0 && (
        <Box sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider' }}>
          <Tooltip title={t('common:expandAll') || 'Expand All'}>
            <Box
              onClick={onExpandAll}
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: 1.5,
                cursor: 'pointer',
                bgcolor: 'action.hover',
                borderRight: 0.5,
                borderColor: 'divider',
                transition: 'background-color 0.2s',
                '&:hover': {
                  bgcolor: 'action.selected'
                },
                '&:active': {
                  bgcolor: 'action.focus'
                }
              }}
            >
              <ExpandAllIcon fontSize="small" />
            </Box>
          </Tooltip>
          <Tooltip title={t('common:collapseAll') || 'Collapse All'}>
            <Box
              onClick={onCollapseAll}
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                py: 1.5,
                cursor: 'pointer',
                bgcolor: 'action.hover',
                borderLeft: 0.5,
                borderColor: 'divider',
                transition: 'background-color 0.2s',
                '&:hover': {
                  bgcolor: 'action.selected'
                },
                '&:active': {
                  bgcolor: 'action.focus'
                }
              }}
            >
              <CollapseAllIcon fontSize="small" />
            </Box>
          </Tooltip>
        </Box>
      )}

      {/* Search Field */}
      {data.length > 0 && (
        <Box sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('common:search') || 'Search...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: searchTerm && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={handleClearSearch}
                    edge="end"
                    sx={{ p: 0.5 }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
              sx: {
                '& .MuiInputBase-input': {
                  py: 0.75,
                  fontSize: '0.875rem'
                }
              }
            }}
          />
        </Box>
      )}

      {/* Tree List */}
      <List
        dense
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 0,
          '& .MuiListItemButton-root': {
            borderRadius: 0
          }
        }}
      >
        {sortedRootNodes.length > 0 ? (
          sortedRootNodes.map((node) => (
            <WildcardTreeNode
              key={node.id}
              node={node}
              level={0}
              selectedId={selectedId}
              expandedIds={effectiveExpandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              sortChildren={sortChildren}
              searchTerm={searchTerm}
            />
          ))
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {searchTerm ? t('common:noSearchResults') || 'No results found' : emptyMessage || t('wildcards:page.noWildcards')}
            </Typography>
          </Box>
        )}
      </List>
    </Paper>
  );
}
