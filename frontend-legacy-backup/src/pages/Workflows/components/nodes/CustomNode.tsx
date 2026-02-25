import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Box, Typography, Paper } from '@mui/material';
import { getNodeColor, getNodeIcon } from '../../utils/nodeStyleHelpers';

interface CustomNodeData {
  label: string;
  classType: string;
  inputs: Record<string, any>;
  rawNode: any;
}

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ data, selected }) => {
  const color = getNodeColor(data.classType);
  const icon = getNodeIcon(data.classType);

  // Count number of inputs and outputs
  const inputCount = Object.keys(data.inputs).filter(
    (key) => Array.isArray(data.inputs[key])
  ).length;
  const outputCount = 1; // Most ComfyUI nodes have at least one output

  return (
    <Paper
      elevation={selected ? 8 : 2}
      sx={{
        minWidth: 200,
        maxWidth: 300,
        border: `2px solid ${color}`,
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        '&:hover': {
          boxShadow: 4,
        },
      }}
    >
      {/* Header */}
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
        <Typography variant="caption" fontWeight="bold" sx={{ flexGrow: 1 }}>
          {data.classType}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ p: 1.5, bgcolor: 'background.paper' }}>
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-line',
            wordBreak: 'break-word',
            fontSize: '0.75rem',
          }}
        >
          {data.label}
        </Typography>

        {/* Display non-connection inputs */}
        {Object.entries(data.inputs)
          .filter(([_, value]) => !Array.isArray(value))
          .slice(0, 3)
          .map(([key, value]) => (
            <Typography
              key={key}
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mt: 0.5,
                fontSize: '0.7rem',
              }}
            >
              {key}: {String(value).length > 20 ? String(value).substring(0, 20) + '...' : String(value)}
            </Typography>
          ))}
      </Box>

      {/* Input handles */}
      {inputCount > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            background: color,
            width: 12,
            height: 12,
            border: '2px solid white',
          }}
        />
      )}

      {/* Output handles */}
      {outputCount > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            background: color,
            width: 12,
            height: 12,
            border: '2px solid white',
          }}
        />
      )}
    </Paper>
  );
};

export default memo(CustomNode);
