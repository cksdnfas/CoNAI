import React, { useState } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import WorkflowGraphViewer from './WorkflowGraphViewer';
import WorkflowJsonViewer from './WorkflowJsonViewer';

interface WorkflowViewerProps {
  open: boolean;
  onClose: () => void;
  workflowName: string;
  workflowJson: string | object;
}

interface TabPanelProps {
  children?: React.ReactNode;
  value: number;
  index: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`workflow-tabpanel-${index}`}
      aria-labelledby={`workflow-tab-${index}`}
      sx={{
        height: '100%',
        display: value === index ? 'flex' : 'none',
        flexDirection: 'column',
      }}
    >
      {value === index && children}
    </Box>
  );
};

const WorkflowViewer: React.FC<WorkflowViewerProps> = ({
  open,
  onClose,
  workflowName,
  workflowJson,
}) => {
  const { t } = useTranslation(['workflows']);
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          height: '90vh',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 0,
        }}
      >
        <Box sx={{ flex: 1 }}>
          {workflowName}
        </Box>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="workflow viewer tabs">
          <Tab label={t('workflows:workflowViewer.graphView')} id="workflow-tab-0" aria-controls="workflow-tabpanel-0" />
          <Tab label={t('workflows:workflowViewer.jsonView')} id="workflow-tab-1" aria-controls="workflow-tabpanel-1" />
        </Tabs>
      </Box>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 3, height: '100%' }}>
        <TabPanel value={tabValue} index={0}>
          <WorkflowGraphViewer workflowJson={workflowJson} />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <WorkflowJsonViewer workflowJson={workflowJson} />
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
};

export default WorkflowViewer;
