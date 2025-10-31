import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Box, Typography, Paper } from '@mui/material';
import {
  Category as CategoryIcon,
  Image as ImageIcon,
  Tune as TuneIcon,
  TextFields as TextIcon,
  Save as SaveIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';

interface CustomNodeData {
  label: string;
  classType: string;
  inputs: Record<string, any>;
  rawNode: any;
}

/**
 * Get node color based on class type category
 */
function getNodeColor(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return '#4CAF50'; // Green for loaders
  } else if (classType.includes('Sampler')) {
    return '#2196F3'; // Blue for samplers
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return '#FF9800'; // Orange for text/CLIP
  } else if (classType.includes('VAE') || classType.includes('Decode') || classType.includes('Encode')) {
    return '#9C27B0'; // Purple for VAE
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return '#F44336'; // Red for output
  } else if (classType.includes('Latent')) {
    return '#00BCD4'; // Cyan for latent
  } else if (classType.includes('Image')) {
    return '#673AB7'; // Deep purple for image processing
  }

  return '#757575'; // Gray for unknown types
}

/**
 * Get icon based on node class type
 */
function getNodeIcon(classType: string) {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return <FolderIcon fontSize="small" />;
  } else if (classType.includes('Sampler')) {
    return <TuneIcon fontSize="small" />;
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return <TextIcon fontSize="small" />;
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return <SaveIcon fontSize="small" />;
  } else if (classType.includes('Image') || classType.includes('Latent')) {
    return <ImageIcon fontSize="small" />;
  }

  return <CategoryIcon fontSize="small" />;
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
