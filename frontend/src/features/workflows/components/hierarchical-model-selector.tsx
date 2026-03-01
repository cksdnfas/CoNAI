import { useMemo, useState } from 'react'
import { Box,
Collapse,
IconButton,
InputAdornment,
List,
ListItemButton,
ListItemIcon,
ListItemText,
Paper,
TextField,
Tooltip,
Typography, } from '@/features/workflows/utils/workflow-ui'
import { ChevronRight as ChevronRightIcon,
ExpandMore as ExpandMoreIcon,
Folder as FolderIcon,
FolderOpen as FolderOpenIcon,
InsertDriveFile as FileIcon,
Search as SearchIcon,
ViewList as ViewListIcon,
AccountTree as TreeIcon, } from '@/features/workflows/utils/workflow-icons'
import { useTranslation } from 'react-i18next'

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children?: TreeNode[]
}

interface HierarchicalModelSelectorProps {
  options: string[]
  value: string
  onChange: (value: string) => void
  label?: string
  helperText?: string
}

function buildTree(items: string[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const item of items) {
    const parts = item.split('/')
    let currentLevel = root

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find((node) => node.name === part)

      if (!existing) {
        existing = {
          name: part,
          path: isLast ? item : path,
          isFolder: !isLast,
          children: isLast ? undefined : [],
        }
        currentLevel.push(existing)
      }

      if (!isLast && existing.children) {
        currentLevel = existing.children
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => {
        if (a.isFolder && !b.isFolder) {
          return -1
        }
        if (!a.isFolder && b.isFolder) {
          return 1
        }
        return a.name.localeCompare(b.name)
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }))

  return sortNodes(root)
}

function filterTree(nodes: TreeNode[], searchTerm: string): TreeNode[] {
  if (!searchTerm) {
    return nodes
  }

  const term = searchTerm.toLowerCase()
  const result: TreeNode[] = []

  for (const node of nodes) {
    if (node.isFolder && node.children) {
      const filteredChildren = filterTree(node.children, searchTerm)
      if (filteredChildren.length > 0) {
        result.push({
          ...node,
          children: filteredChildren,
        })
      }
    } else if (node.name.toLowerCase().includes(term)) {
      result.push(node)
    }
  }

  return result
}

interface TreeNodeItemProps {
  node: TreeNode
  depth: number
  selectedValue: string
  onSelect: (path: string) => void
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
}

function TreeNodeItem({ node, depth, selectedValue, onSelect, expandedFolders, onToggleFolder }: TreeNodeItemProps) {
  const isExpanded = expandedFolders.has(node.path)
  const isSelected = selectedValue === node.path

  const handleClick = () => {
    if (node.isFolder) {
      onToggleFolder(node.path)
      return
    }
    onSelect(node.path)
  }

  return (
    <>
      <ListItemButton
        onClick={handleClick}
        aria-selected={isSelected}
        sx={{
          pl: 1 + depth * 2,
          py: 0.5,
          borderRadius: 1,
          bgcolor: isSelected ? 'primary.main' : 'transparent',
          color: isSelected ? 'primary.contrastText' : 'inherit',
          '&:hover': {
            bgcolor: isSelected ? 'primary.dark' : 'action.hover',
          },
        }}
      >
        {node.isFolder ? (
          <ListItemIcon sx={{ minWidth: 24 }}>
            {isExpanded ? <ExpandMoreIcon sx={{ fontSize: '1rem' }} /> : <ChevronRightIcon sx={{ fontSize: '1rem' }} />}
          </ListItemIcon>
        ) : null}
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
            noWrap: true,
          }}
        />
      </ListItemButton>

      {node.isFolder && node.children ? (
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
      ) : null}
    </>
  )
}

export function HierarchicalModelSelector({ options, value, onChange, label, helperText }: HierarchicalModelSelectorProps) {
  const { t } = useTranslation(['workflows'])
  const [viewMode, setViewMode] = useState<'dropdown' | 'tree'>('dropdown')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(options), [options])
  const filteredTree = useMemo(() => filterTree(tree, searchTerm), [tree, searchTerm])

  const handleToggleFolder = (path: string) => {
    const next = new Set(expandedFolders)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setExpandedFolders(next)
  }

  const expandAll = () => {
    const allFolders = new Set<string>()
    const collectFolders = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isFolder) {
          allFolders.add(node.path)
          if (node.children) {
            collectFolders(node.children)
          }
        }
      }
    }
    collectFolders(tree)
    setExpandedFolders(allFolders)
  }

  const hasSubfolders = options.some((option) => option.includes('/'))

  if (viewMode === 'dropdown') {
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          fullWidth
          select
          label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
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
        {hasSubfolders ? (
          <Tooltip title={t('workflows:form.switchToTree', 'Switch to tree view')}>
            <IconButton onClick={() => setViewMode('tree')} sx={{ mt: 1 }}>
              <TreeIcon />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Tooltip title={t('workflows:form.switchToDropdown', 'Switch to dropdown')}>
          <IconButton onClick={() => setViewMode('dropdown')} size="small">
            <ViewListIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Paper variant="outlined" sx={{ p: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('workflows:form.searchModel', 'Search model...')}
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value)
            if (event.target.value) {
              expandAll()
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: '1.2rem' }} />
              </InputAdornment>
            ),
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
              {searchTerm ? t('workflows:form.noSearchResults', 'No search results') : t('workflows:form.noModels', 'No models')}
            </Typography>
          )}
        </Box>

        {value ? (
          <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary">
              {t('workflows:form.selected', 'Selected')}:
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-all' }}>
              {value}
            </Typography>
          </Box>
        ) : null}
      </Paper>

      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {helperText}
        </Typography>
      ) : null}
    </Box>
  )
}
