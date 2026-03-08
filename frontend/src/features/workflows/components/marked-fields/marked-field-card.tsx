import { useState, type HTMLAttributes } from 'react'
import {
  Card,
  CardContent,
  Box,
  TextField,
  IconButton,
  FormControlLabel,
  Switch,
  Collapse,
  Typography,
  Chip,
  alpha,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@/features/workflows/utils/workflow-ui'
import {
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  DragIndicator as DragIndicatorIcon,
  PlaylistAdd as PlaylistAddIcon,
} from '@/features/workflows/utils/workflow-icons'
import { useTranslation } from 'react-i18next'
import type { MarkedField } from '@/services/workflow-api'
import { generateFieldId } from './utils/smart-defaults'
import type { FieldError } from './hooks/use-marked-field-validation'
import { customDropdownListApi, type CustomDropdownList } from '@/services/custom-dropdown-list-api'

const FIELD_TYPE_CONFIG: Record<MarkedField['type'], { label: string; icon: string; color: string }> = {
  text: { label: 'Text', icon: 'txt', color: '#4caf50' },
  textarea: { label: 'Textarea', icon: 'txt', color: '#4caf50' },
  number: { label: 'Number', icon: '#', color: '#2196f3' },
  select: { label: 'Select', icon: '[]', color: '#ff9800' },
  image: { label: 'Image', icon: 'img', color: '#9c27b0' },
}

interface MarkedFieldCardProps {
  field: MarkedField
  index: number
  onUpdate: (index: number, updates: Partial<MarkedField>) => void
  onDelete: (index: number) => void
  dragHandleProps?: HTMLAttributes<HTMLElement>
  fieldErrors?: FieldError[]
  isExpanded: boolean
  onToggleExpand: () => void
}

export function MarkedFieldCard({
  field,
  index,
  onUpdate,
  onDelete,
  dragHandleProps,
  fieldErrors = [],
  isExpanded,
  onToggleExpand,
}: MarkedFieldCardProps) {
  const { t } = useTranslation()
  const [listDialogOpen, setListDialogOpen] = useState(false)
  const [customLists, setCustomLists] = useState<CustomDropdownList[]>([])

  const typeConfig = FIELD_TYPE_CONFIG[field.type]

  const handleOpenListDialog = async () => {
    try {
      const response = await customDropdownListApi.getAllLists()
      setCustomLists(response.data || [])
      setListDialogOpen(true)
    } catch (error) {
      console.error('Failed to load custom lists:', error)
    }
  }

  const handleSelectList = (list: CustomDropdownList) => {
    onUpdate(index, {
      dropdown_list_name: list.name,
      options: list.items,
    })
    setListDialogOpen(false)
  }

  const handleLabelChange = (newLabel: string) => {
    const updates: Partial<MarkedField> = { label: newLabel }

    if (!field.id || field.id.trim() === '') {
      const generatedId = generateFieldId(newLabel)
      if (generatedId) {
        updates.id = generatedId
      }
    }

    onUpdate(index, updates)
  }

  const getNodeInfo = (jsonPath: string) => {
    const match = jsonPath.match(/^(\d+)\./)
    return match ? `Node ${match[1]}` : jsonPath
  }

  return (
    <Card
      sx={{
        mb: 2,
        borderLeft: `4px solid ${typeConfig.color}`,
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        bgcolor: isExpanded ? alpha(typeConfig.color, 0.02) : 'background.paper',
        '&:hover': {
          boxShadow: isExpanded ? 6 : 4,
          transform: 'translateY(-2px)',
          borderLeftWidth: '6px',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
        onClick={onToggleExpand}
      >
        <Box
          {...dragHandleProps}
          sx={{
            display: 'flex',
            alignItems: 'center',
            mr: 1.5,
            cursor: 'grab',
            opacity: 0.3,
            transition: 'all 0.2s ease',
            color: typeConfig.color,
            '&:hover': {
              opacity: 1,
              transform: 'scale(1.1)',
            },
            '&:active': {
              cursor: 'grabbing',
              transform: 'scale(0.95)',
            },
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>

        <Typography sx={{ fontSize: '1.2rem', mr: 1 }}>{typeConfig.icon}</Typography>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {field.label || t('workflows:markedFields.unnamedField')}
            {field.required ? (
              <Chip label="Required" size="small" color="error" sx={{ ml: 1, height: 20, fontSize: '0.7rem' }} />
            ) : null}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {field.jsonPath ? `${getNodeInfo(field.jsonPath)} - ${field.jsonPath}` : t('workflows:markedFields.noJsonPath')}
          </Typography>
          {fieldErrors.length > 0 ? (
            <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.2 }}>
              {fieldErrors.map((error, errorIndex) => (
                <Typography
                  key={`${error.field}-${errorIndex}`}
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: error.severity === 'error' ? 'error.main' : 'warning.main',
                    fontSize: '0.7rem',
                    fontWeight: 500,
                  }}
                >
                  {error.severity === 'error' ? 'ERR' : 'WARN'} {error.message}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Box>

        <Chip
          label={typeConfig.label}
          size="small"
          sx={{
            bgcolor: alpha(typeConfig.color, 0.1),
            color: typeConfig.color,
            fontWeight: 600,
            mr: 1,
          }}
        />

        <IconButton
          size="small"
          sx={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s',
          }}
        >
          <ExpandMoreIcon />
        </IconButton>
      </Box>

      <Collapse in={isExpanded} timeout={{ enter: 300, exit: 250 }} unmountOnExit>
        <CardContent
          sx={{
            pt: 2,
            pb: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
          }}
        >
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label={t('workflows:fieldForm.label')}
              value={field.label}
              onChange={(event) => handleLabelChange(event.target.value)}
              size="small"
              placeholder={t('workflows:fieldForm.labelPlaceholder')}
              helperText={t('workflows:fieldForm.labelHelper')}
              sx={{ flex: 2 }}
            />
            <TextField
              select
              label={t('workflows:fieldForm.type')}
              value={field.type}
              onChange={(event) => onUpdate(index, { type: event.target.value as MarkedField['type'] })}
              size="small"
              helperText={t('workflows:fieldForm.typeHelper')}
              sx={{ flex: 1 }}
            >
              <option value="text">{t('workflows:fieldForm.typeText')}</option>
              <option value="textarea">{t('workflows:fieldForm.typeTextarea')}</option>
              <option value="number">{t('workflows:fieldForm.typeNumber')}</option>
              <option value="select">{t('workflows:fieldForm.typeSelect')}</option>
              <option value="image">Image</option>
            </TextField>
          </Box>

          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            label={t('workflows:fieldForm.description')}
            value={field.description || ''}
            onChange={(event) => onUpdate(index, { description: event.target.value })}
            size="small"
            placeholder={t('workflows:fieldForm.descriptionPlaceholder')}
            helperText={t('workflows:fieldForm.descriptionHelper')}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              fullWidth
              label={t('workflows:fieldForm.jsonPath')}
              value={field.jsonPath}
              onChange={(event) => onUpdate(index, { jsonPath: event.target.value })}
              placeholder={t('workflows:fieldForm.jsonPathPlaceholder')}
              size="small"
              helperText={t('workflows:fieldForm.jsonPathHelper')}
              sx={{ flex: 2 }}
            />
            <TextField
              fullWidth
              label={t('workflows:fieldForm.defaultValue')}
              value={typeof field.default_value === 'string' || typeof field.default_value === 'number' ? field.default_value : ''}
              onChange={(event) => onUpdate(index, { default_value: event.target.value })}
              size="small"
              placeholder={t('workflows:fieldForm.defaultValuePlaceholder')}
              helperText={t('workflows:fieldForm.defaultValueHelper')}
              sx={{ flex: 1 }}
            />
          </Box>

          {field.type === 'number' ? (
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                label={t('workflows:fieldForm.minValue')}
                type="number"
                value={field.min ?? ''}
                onChange={(event) => onUpdate(index, { min: event.target.value ? parseFloat(event.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:fieldForm.minPlaceholder')}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('workflows:fieldForm.maxValue')}
                type="number"
                value={field.max ?? ''}
                onChange={(event) => onUpdate(index, { max: event.target.value ? parseFloat(event.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:fieldForm.maxPlaceholder')}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('workflows:markedFields.stepLabel')}
                type="number"
                value={field.step ?? ''}
                onChange={(event) => onUpdate(index, { step: event.target.value ? parseFloat(event.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:markedFields.stepPlaceholder')}
                helperText={t('workflows:markedFields.stepHelperText')}
                inputProps={{ step: 'any', min: 0 }}
                sx={{ flex: 1 }}
              />
            </Box>
          ) : null}

          {field.type === 'select' ? (
            <Box sx={{ mb: 2 }}>
              {field.dropdown_list_name ? (
                <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={`List: ${field.dropdown_list_name}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                    onDelete={() => onUpdate(index, { dropdown_list_name: undefined })}
                    sx={{ fontWeight: 500 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t('workflows:markedFields.autoUpdated')}
                  </Typography>
                </Box>
              ) : null}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth
                  label={t('workflows:fieldForm.selectOptions')}
                  value={field.options?.join(', ') || ''}
                  onChange={(event) =>
                    onUpdate(index, {
                      options: event.target.value
                        .split(',')
                        .map((item: string) => item.trim())
                        .filter((item: string) => item),
                    })
                  }
                  size="small"
                  placeholder={t('workflows:fieldForm.selectOptionsPlaceholder')}
                  helperText={
                    field.dropdown_list_name
                      ? t('workflows:markedFields.listPreviewHelper')
                      : t('workflows:fieldForm.selectOptionsHelper')
                  }
                  disabled={Boolean(field.dropdown_list_name)}
                />
                <IconButton
                  size="small"
                  onClick={handleOpenListDialog}
                  title={t('workflows:markedFields.loadFromListTooltip')}
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                >
                  <PlaylistAddIcon />
                </IconButton>
              </Box>
            </Box>
          ) : null}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={field.required || false}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => onUpdate(index, { required: event.target.checked })}
                  size="small"
                />
              }
              label={t('workflows:fieldForm.required')}
            />
            <IconButton onClick={() => onDelete(index)} color="error" size="small">
              <DeleteIcon />
            </IconButton>
          </Box>
        </CardContent>
      </Collapse>

      <Dialog open={listDialogOpen} onClose={() => setListDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('workflows:markedFields.loadFromListTitle')}</DialogTitle>
        <DialogContent>
          {customLists.length === 0 ? (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
              {t('workflows:markedFields.noCustomLists')}
            </Typography>
          ) : (
            <List>
              {customLists.map((list) => (
                <ListItem key={list.id} disablePadding>
                  <ListItemButton onClick={() => handleSelectList(list)}>
                    <ListItemText
                      primary={list.name}
                      secondary={`${t('workflows:markedFields.itemCount', { count: list.items.length })}${list.items
                        .slice(0, 3)
                        .join(', ')}${list.items.length > 3 ? '...' : ''}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setListDialogOpen(false)}>{t('common:buttons.cancel')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
