import {
  Box,
  Paper,
  List,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon
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

  // 루트 레벨 정렬
  const sortedRootNodes = sortChildren ? [...data].sort(sortChildren) : data;

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
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              sortChildren={sortChildren}
            />
          ))
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {emptyMessage || t('wildcards:page.noWildcards')}
            </Typography>
          </Box>
        )}
      </List>
    </Paper>
  );
}
