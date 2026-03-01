import { useState } from 'react'
import { Box,
Chip,
FormControl,
IconButton,
InputLabel,
MenuItem,
Paper,
Select,
TextField,
Tooltip, } from '@/features/workflows/utils/workflow-ui'
import type { SelectChangeEvent } from '@/features/workflows/utils/workflow-ui'
import { Search as SearchIcon,
UnfoldLess as CollapseAllIcon,
UnfoldMore as ExpandAllIcon,
ViewList as ViewListIcon,
ViewModule as ViewModuleIcon, } from '@/features/workflows/utils/workflow-icons'
import { useTranslation } from 'react-i18next'

interface GraphToolbarProps {
  onSearchChange: (search: string) => void
  onFilterChange: (filters: string[]) => void
  onLayoutChange: (layout: 'LR' | 'TB') => void
  onExpandAll?: () => void
  onCollapseAll?: () => void
  nodeTypes: string[]
  layout: 'LR' | 'TB'
}

export default function GraphToolbar({
  onSearchChange,
  onFilterChange,
  onLayoutChange,
  onExpandAll,
  onCollapseAll,
  nodeTypes,
  layout,
}: GraphToolbarProps) {
  const { t } = useTranslation(['workflows'])
  const [search, setSearch] = useState('')
  const [selectedFilters, setSelectedFilters] = useState<string[]>([])

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setSearch(value)
    onSearchChange(value)
  }

  const handleFilterChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value as string[] | string
    const nextFilters = Array.isArray(value) ? value : value.split(',').filter(Boolean)
    setSelectedFilters(nextFilters)
    onFilterChange(nextFilters)
  }

  return (
    <Paper
      elevation={1}
      sx={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 5,
        p: 1.5,
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        bgcolor: 'rgba(42, 42, 42, 0.95)',
        borderRadius: 2,
        maxWidth: '600px',
        flexWrap: 'wrap',
        border: '1px solid rgba(64, 64, 64, 0.5)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
      }}
    >
      <TextField
        size="small"
        placeholder={t('workflows:graphToolbar.searchPlaceholder')}
        value={search}
        onChange={handleSearchChange}
        InputProps={{
          startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />,
        }}
        sx={{ minWidth: 180 }}
      />

      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel>{t('workflows:graphToolbar.filterTypes')}</InputLabel>
        <Select
          multiple
          value={selectedFilters}
          onChange={handleFilterChange}
          label={t('workflows:graphToolbar.filterTypes')}
          renderValue={(selected: string[]) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((value: string) => (
                <Chip
                  key={value}
                  label={value}
                  size="small"
                  sx={{
                    bgcolor: 'rgba(76, 175, 80, 0.2)',
                    color: '#4CAF50',
                    border: '1px solid rgba(76, 175, 80, 0.4)',
                  }}
                />
              ))}
            </Box>
          )}
          MenuProps={{
            PaperProps: {
              sx: {
                bgcolor: '#2a2a2a',
                border: '1px solid rgba(64, 64, 64, 0.5)',
              },
            },
          }}
        >
          {nodeTypes.map((type) => {
            const isTypeSelected = selectedFilters.includes(type)

            return (
              <MenuItem
                key={type}
                value={type}
                aria-selected={isTypeSelected}
                sx={{
                  color: '#ffffff',
                  fontWeight: isTypeSelected ? 600 : 400,
                  bgcolor: isTypeSelected ? 'rgba(76, 175, 80, 0.2)' : 'transparent',
                  '&:hover': {
                    bgcolor: isTypeSelected ? 'rgba(76, 175, 80, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                  },
                }}
              >
                {type}
              </MenuItem>
            )
          })}
        </Select>
      </FormControl>

      <Tooltip
        title={t('workflows:graphToolbar.layoutSwitch', {
          layout: layout === 'LR' ? t('workflows:graphToolbar.layoutTopBottom') : t('workflows:graphToolbar.layoutLeftRight'),
        })}
      >
        <IconButton size="small" onClick={() => onLayoutChange(layout === 'LR' ? 'TB' : 'LR')}>
          {layout === 'LR' ? <ViewListIcon /> : <ViewModuleIcon />}
        </IconButton>
      </Tooltip>

      {onExpandAll ? (
        <Tooltip title={t('workflows:graphToolbar.expandAll')}>
          <IconButton size="small" onClick={onExpandAll}>
            <ExpandAllIcon />
          </IconButton>
        </Tooltip>
      ) : null}

      {onCollapseAll ? (
        <Tooltip title={t('workflows:graphToolbar.collapseAll')}>
          <IconButton size="small" onClick={onCollapseAll}>
            <CollapseAllIcon />
          </IconButton>
        </Tooltip>
      ) : null}
    </Paper>
  )
}
