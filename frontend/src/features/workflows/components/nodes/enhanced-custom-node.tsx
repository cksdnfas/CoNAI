import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Box, Collapse, Divider, IconButton, Paper, Tooltip, Typography } from '@/features/workflows/utils/workflow-ui'
import { ExpandLess as ExpandLessIcon,
ExpandMore as ExpandMoreIcon,
Input as InputIcon,
Output as OutputIcon,
Settings as SettingsIcon, } from '@/features/workflows/utils/workflow-icons'
import type { EnhancedNodeData } from '@/features/workflows/utils/node-data-parser'
import { getDataTypeColor, getDataTypeLabel } from '@/features/workflows/utils/data-type-colors'
import { getNodeColor, getNodeIcon } from '@/features/workflows/utils/node-style-helpers'

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.length > 50 ? `${value.substring(0, 50)}...` : value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return '{...}'
  return String(value)
}

function calculateHandlePosition(index: number, total: number, offset = 40): number {
  if (total === 1) return 50
  const spacing = Math.min(80 / (total + 1), 30)
  const startPercent = offset + 10
  return startPercent + (index + 1) * spacing
}

interface EnhancedCustomNodeProps extends NodeProps {
  data: EnhancedNodeData
  onParameterContextMenu?: (
    nodeId: string,
    paramKey: string,
    paramValue: unknown,
    paramType: string,
    event: React.MouseEvent,
  ) => void
}

function EnhancedCustomNode({ data, selected, id, onParameterContextMenu }: EnhancedCustomNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const color = getNodeColor(data.classType)
  const icon = getNodeIcon(data.classType)

  const connectionInputs = data.inputs.filter((input) => input.type === 'connection')
  const parameterInputs = data.inputs.filter((input) => input.type === 'parameter')

  const handleParameterRightClick = (paramKey: string, paramValue: unknown, dataType: string) => (event: React.MouseEvent) => {
    if (onParameterContextMenu) {
      onParameterContextMenu(id, paramKey, paramValue, dataType, event)
    }
  }

  return (
    <Paper
      elevation={selected ? 8 : 2}
      sx={{
        minWidth: 250,
        maxWidth: 350,
        border: `2px solid ${color}`,
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        '&:hover': {
          boxShadow: 6,
        },
      }}
    >
      <Box
        sx={{
          bgcolor: color,
          color: 'white',
          p: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {icon}
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="caption" fontWeight="bold" sx={{ display: 'block', fontSize: '0.85rem' }}>
            #{data.nodeId} - {data.title}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.9, fontSize: '0.7rem' }}>
            {data.classType}
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => setExpanded((previous) => !previous)} sx={{ color: 'white', p: 0.5 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ p: 1.5, bgcolor: 'background.paper' }}>
          {data.inputs.length > 0 ? (
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <InputIcon sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />
                <Typography variant="caption" fontWeight="600" sx={{ fontSize: '0.75rem' }}>
                  INPUTS ({data.inputs.length})
                </Typography>
              </Box>
              <Box sx={{ pl: 1 }}>
                {connectionInputs.map((input) => (
                  <Tooltip key={input.name} title={`From #${input.sourceNode} [${getDataTypeLabel(input.dataType || 'UNKNOWN')}]`} arrow>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.75rem',
                        mb: 0.3,
                        color: 'text.primary',
                      }}
                    >
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: getDataTypeColor(input.dataType || 'UNKNOWN'),
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>{input.name}</span>
                      <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>[from #{input.sourceNode}]</span>
                    </Typography>
                  </Tooltip>
                ))}

                {parameterInputs.map((input) => (
                  <Tooltip
                    key={input.name}
                    title={`${input.name}: ${String(input.value)} (Right-click to add to Marked Fields)`}
                    arrow
                  >
                    <Typography
                      variant="caption"
                      onContextMenu={handleParameterRightClick(input.name, input.value, input.dataType || 'text')}
                      sx={{
                        display: 'block',
                        fontSize: '0.75rem',
                        mb: 0.3,
                        color: 'text.secondary',
                        cursor: 'context-menu',
                        '&:hover': {
                          bgcolor: 'rgba(33, 150, 243, 0.1)',
                          borderRadius: '4px',
                          px: 0.5,
                        },
                      }}
                    >
                      - {input.name}: <span style={{ fontWeight: 500 }}>{formatValue(input.value)}</span>
                    </Typography>
                  </Tooltip>
                ))}
              </Box>
            </Box>
          ) : null}

          {data.widgets.length > 0 ? (
            <Box sx={{ mb: 1.5 }}>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <SettingsIcon sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />
                <Typography variant="caption" fontWeight="600" sx={{ fontSize: '0.75rem' }}>
                  WIDGETS ({data.widgets.length})
                </Typography>
              </Box>
              <Box sx={{ pl: 1 }}>
                {data.widgets.map((widget, index) => (
                  <Tooltip key={`${widget.name}-${index}`} title={`${widget.name}: ${String(widget.value)} (${widget.type})`} arrow>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        fontSize: '0.75rem',
                        mb: 0.3,
                        color: 'text.secondary',
                      }}
                    >
                      - {widget.name}: <span style={{ fontWeight: 500 }}>{formatValue(widget.value)}</span>
                    </Typography>
                  </Tooltip>
                ))}
              </Box>
            </Box>
          ) : null}

          {data.outputs.length > 0 ? (
            <Box>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <OutputIcon sx={{ fontSize: '0.9rem', color: 'text.secondary' }} />
                <Typography variant="caption" fontWeight="600" sx={{ fontSize: '0.75rem' }}>
                  OUTPUTS ({data.outputs.length})
                </Typography>
              </Box>
              <Box sx={{ pl: 1 }}>
                {data.outputs.map((output) => (
                  <Typography
                    key={output.slot}
                    variant="caption"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      fontSize: '0.75rem',
                      mb: 0.3,
                      color: 'text.primary',
                    }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: getDataTypeColor(output.dataType),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 500 }}>{output.name}</span>
                    <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>[{getDataTypeLabel(output.dataType)}]</span>
                  </Typography>
                ))}
              </Box>
            </Box>
          ) : null}
        </Box>
      </Collapse>

      {connectionInputs.map((input, index) => {
        const handleColor = getDataTypeColor(input.dataType || 'UNKNOWN')
        const position = calculateHandlePosition(index, connectionInputs.length, 40)

        return (
          <Handle
            key={`input-${input.name}`}
            type="target"
            position={Position.Left}
            id={`input-${input.name}`}
            style={{
              background: handleColor,
              width: 12,
              height: 12,
              border: '2px solid white',
              top: `${position}%`,
            }}
          />
        )
      })}

      {data.outputs.map((output, index) => {
        const handleColor = getDataTypeColor(output.dataType)
        const position = calculateHandlePosition(index, data.outputs.length, 40)

        return (
          <Handle
            key={`output-${output.slot}`}
            type="source"
            position={Position.Right}
            id={`output-${output.slot}`}
            style={{
              background: handleColor,
              width: 12,
              height: 12,
              border: '2px solid white',
              top: `${position}%`,
            }}
          />
        )
      })}
    </Paper>
  )
}

export default memo(EnhancedCustomNode)
