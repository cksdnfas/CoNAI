import { useMemo } from 'react';
import {
  Box,
  IconButton,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse
} from '@mui/material';
import {
  FolderOpen as FolderOpenIcon,
  Folder as FolderClosedIcon,
  Description as FileIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import type { WildcardWithHierarchy } from '../../services/api/wildcardApi';

interface WildcardTreeNodeProps {
  node: WildcardWithHierarchy;
  level: number;
  selectedId: number | null;
  expandedIds: Set<number>;
  onSelect: (node: WildcardWithHierarchy) => void;
  onToggle: (id: number) => void;
  sortChildren?: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number;
  searchTerm?: string;
}

/**
 * 검색어와 일치하는 부분을 하이라이트하는 컴포넌트
 */
function HighlightedText({ text, searchTerm }: { text: string; searchTerm?: string }) {
  if (!searchTerm || !searchTerm.trim()) {
    return <>{text}</>;
  }

  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);

  if (index === -1) {
    return <>{text}</>;
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + searchTerm.length);
  const after = text.slice(index + searchTerm.length);

  return (
    <>
      {before}
      <Box
        component="span"
        sx={{
          bgcolor: 'warning.main',
          color: 'warning.contrastText',
          borderRadius: 0.5,
          px: 0.25
        }}
      >
        {match}
      </Box>
      {after}
    </>
  );
}

/**
 * 재귀적으로 렌더링되는 트리 노드 컴포넌트
 * 폴더(자식 있음)와 파일(리프 노드)를 구분하여 표시
 */
export function WildcardTreeNode({
  node,
  level,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  sortChildren,
  searchTerm
}: WildcardTreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const handleClick = () => {
    onSelect(node);
    if (hasChildren && !isExpanded) {
      onToggle(node.id);
    }
  };

  // 자식 노드 정렬
  const sortedChildren = hasChildren && sortChildren
    ? [...node.children!].sort(sortChildren)
    : node.children || [];

  return (
    <>
      <ListItemButton
        onClick={handleClick}
        selected={isSelected}
        sx={{
          pl: 1 + level * 2,
          py: 0.5,
          minHeight: 36,
          '&.Mui-selected': {
            bgcolor: 'primary.dark',
            '&:hover': { bgcolor: 'primary.dark' }
          }
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            sx={{ p: 0.25, mr: 0.5 }}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 28 }} />
        )}
        <ListItemIcon sx={{ minWidth: 28 }}>
          {hasChildren ? (
            isExpanded ? <FolderOpenIcon fontSize="small" color="warning" /> : <FolderClosedIcon fontSize="small" color="warning" />
          ) : (
            <FileIcon fontSize="small" color="info" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={<HighlightedText text={node.name} searchTerm={searchTerm} />}
          primaryTypographyProps={{
            variant: 'body2',
            noWrap: true,
            sx: { fontWeight: isSelected ? 600 : 400 }
          }}
        />
      </ListItemButton>
      {hasChildren && (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          {sortedChildren.map((child) => (
            <WildcardTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              sortChildren={sortChildren}
              searchTerm={searchTerm}
            />
          ))}
        </Collapse>
      )}
    </>
  );
}
