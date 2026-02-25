import { useState, useMemo } from 'react';
import {
  Box,
  TextField,
  Typography,
  IconButton,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  InputAdornment,
  Paper,
  Tooltip
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  InsertDriveFile as FileIcon,
  Search as SearchIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  ViewList as ViewListIcon,
  AccountTree as TreeIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: TreeNode[];
}

interface HierarchicalModelSelectorProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
}

/**
 * items 배열에서 트리 구조 생성
 * "SD1.5/model1.safetensors" → { SD1.5: { children: [model1.safetensors] } }
 */
function buildTree(items: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const item of items) {
    const parts = item.split('/');
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let existing = currentLevel.find(node => node.name === part);

      if (!existing) {
        existing = {
          name: part,
          path: isLast ? item : path,
          isFolder: !isLast,
          children: isLast ? undefined : []
        };
        currentLevel.push(existing);
      }

      if (!isLast && existing.children) {
        currentLevel = existing.children;
      }
    }
  }

  // 정렬: 폴더 먼저, 그 다음 파일 (알파벳순)
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    }).map(node => ({
      ...node,
      children: node.children ? sortNodes(node.children) : undefined
    }));
  };

  return sortNodes(root);
}

/**
 * 검색어로 트리 필터링
 */
function filterTree(nodes: TreeNode[], searchTerm: string): TreeNode[] {
  if (!searchTerm) return nodes;

  const term = searchTerm.toLowerCase();
  const result: TreeNode[] = [];

  for (const node of nodes) {
    if (node.isFolder && node.children) {
      const filteredChildren = filterTree(node.children, searchTerm);
      if (filteredChildren.length > 0) {
        result.push({
          ...node,
          children: filteredChildren
        });
      }
    } else if (node.name.toLowerCase().includes(term)) {
      result.push(node);
    }
  }

  return result;
}

function TreeNodeItem({
  node,
  depth,
  selectedValue,
  onSelect,
  expandedFolders,
  onToggleFolder
}: {
  node: TreeNode;
  depth: number;
  selectedValue: string;
  onSelect: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedValue === node.path;

  const handleClick = () => {
    if (node.isFolder) {
      onToggleFolder(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <>
      <ListItemButton
        onClick={handleClick}
        selected={isSelected}
        sx={{
          pl: 1 + depth * 2,
          py: 0.5,
          borderRadius: 1,
          '&.Mui-selected': {
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              bgcolor: 'primary.dark'
            }
          }
        }}
      >
        {node.isFolder && (
          <ListItemIcon sx={{ minWidth: 24 }}>
            {isExpanded ? (
              <ExpandMoreIcon sx={{ fontSize: '1rem' }} />
            ) : (
              <ChevronRightIcon sx={{ fontSize: '1rem' }} />
            )}
          </ListItemIcon>
        )}
        <ListItemIcon sx={{ minWidth: 28 }}>
          {node.isFolder ? (
            isExpanded ? (
              <FolderOpenIcon sx={{ fontSize: '1.1rem', color: 'warning.main' }} />
            ) : (
              <FolderIcon sx={{ fontSize: '1.1rem', color: 'warning.main' }} />
            )
          ) : (
            <FileIcon sx={{ fontSize: '1rem', color: 'text.secondary' }} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={node.name}
          primaryTypographyProps={{
            fontSize: '0.85rem',
            fontWeight: isSelected ? 600 : 400,
            noWrap: true
          }}
        />
      </ListItemButton>

      {node.isFolder && node.children && (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List disablePadding>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedValue={selectedValue}
                onSelect={onSelect}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}

export function HierarchicalModelSelector({
  options,
  value,
  onChange,
  label,
  helperText
}: HierarchicalModelSelectorProps) {
  const { t } = useTranslation(['workflows']);
  const [viewMode, setViewMode] = useState<'dropdown' | 'tree'>('dropdown');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 트리 구조 생성
  const tree = useMemo(() => buildTree(options), [options]);

  // 검색 필터링된 트리
  const filteredTree = useMemo(() => filterTree(tree, searchTerm), [tree, searchTerm]);

  // 폴더 토글
  const handleToggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  // 모든 폴더 펼치기
  const expandAll = () => {
    const allFolders = new Set<string>();
    const collectFolders = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isFolder) {
          allFolders.add(node.path);
          if (node.children) collectFolders(node.children);
        }
      }
    };
    collectFolders(tree);
    setExpandedFolders(allFolders);
  };

  // 옵션에 폴더가 포함되어 있는지 확인 (트리뷰 사용 여부)
  const hasSubfolders = options.some(opt => opt.includes('/'));

  // 드롭다운 모드
  if (viewMode === 'dropdown') {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          fullWidth
          select
          label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          SelectProps={{ native: true }}
          helperText={helperText}
          sx={{ flex: 1 }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </TextField>
        {hasSubfolders && (
          <Tooltip title={t('workflows:form.switchToTree', '트리뷰로 전환')}>
            <IconButton
              onClick={() => setViewMode('tree')}
              sx={{ mt: 1 }}
            >
              <TreeIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  // 트리뷰 모드
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Tooltip title={t('workflows:form.switchToDropdown', '드롭다운으로 전환')}>
          <IconButton onClick={() => setViewMode('dropdown')} size="small">
            <ViewListIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Paper variant="outlined" sx={{ p: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('workflows:form.searchModel', '모델 검색...')}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (e.target.value) expandAll();
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: '1.2rem' }} />
              </InputAdornment>
            )
          }}
          sx={{ mb: 1 }}
        />

        <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
          {filteredTree.length > 0 ? (
            <List dense disablePadding>
              {filteredTree.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedValue={value}
                  onSelect={onChange}
                  expandedFolders={expandedFolders}
                  onToggleFolder={handleToggleFolder}
                />
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
              {searchTerm
                ? t('workflows:form.noSearchResults', '검색 결과 없음')
                : t('workflows:form.noModels', '모델 없음')
              }
            </Typography>
          )}
        </Box>

        {value && (
          <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary">
              {t('workflows:form.selected', '선택됨')}:
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-all' }}>
              {value}
            </Typography>
          </Box>
        )}
      </Paper>

      {helperText && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );
}

export default HierarchicalModelSelector;
