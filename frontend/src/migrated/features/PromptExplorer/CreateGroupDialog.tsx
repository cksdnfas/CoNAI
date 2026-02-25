import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    Alert,
    CircularProgress
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { GroupTreePanel } from './GroupTreePanel';
import type { PromptGroupWithChildren } from './utils';

interface CreateGroupDialogProps {
    open: boolean;
    onClose: () => void;
    onCreate: (name: string, parentId: number | null) => Promise<void>;
    groups: PromptGroupWithChildren[];
}

export const CreateGroupDialog: React.FC<CreateGroupDialogProps> = ({
    open,
    onClose,
    onCreate,
    groups
}) => {
    const { t } = useTranslation(['common']);
    const [groupName, setGroupName] = useState('');
    const [parentId, setParentId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    const handleCreate = async () => {
        if (!groupName.trim()) {
            setError('Group name is required');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            await onCreate(groupName, parentId);
            onClose();
            setGroupName('');
            setParentId(null);
        } catch (err) {
            console.error(err);
            setError('Failed to create group');
        } finally {
            setLoading(false);
        }
    };

    // Helper to flatten IDs for expand all (duplicating to avoid circular deps or complex shared files for now)
    const getAllIds = (nodes: PromptGroupWithChildren[]): number[] => {
        let ids: number[] = [];
        for (const node of nodes) {
            ids.push(node.id);
            if (node.children) {
                ids = [...ids, ...getAllIds(node.children)];
            }
        }
        return ids;
    };

    return (
        <Dialog open={open} onClose={() => !loading && onClose()} maxWidth="xs" fullWidth>
            <DialogTitle>Create New Group</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <TextField
                    autoFocus
                    margin="dense"
                    label="Group Name"
                    fullWidth
                    variant="outlined"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    disabled={loading}
                    sx={{ mb: 2 }}
                />

                <Typography variant="subtitle2" gutterBottom>
                    Parent Group (Optional)
                </Typography>
                <Box sx={{
                    height: 300,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    overflow: 'hidden'
                }}>
                    <GroupTreePanel
                        data={groups}
                        selectedId={parentId}
                        expandedIds={expandedIds}
                        onSelect={(node) => setParentId(node.id === parentId ? null : node.id)} // Toggle selection
                        onToggle={(id) => {
                            const newExpanded = new Set(expandedIds);
                            if (newExpanded.has(id)) {
                                newExpanded.delete(id);
                            } else {
                                newExpanded.add(id);
                            }
                            setExpandedIds(newExpanded);
                        }}
                        onExpandAll={() => setExpandedIds(new Set(getAllIds(groups)))}
                        onCollapseAll={() => setExpandedIds(new Set())}
                    />
                </Box>
                <Typography variant="caption" color="text.secondary">
                    {parentId ? `Selected Parent: ID ${parentId}` : 'No parent selected (Root level)'}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>Cancel</Button>
                <Button onClick={handleCreate} variant="contained" disabled={loading || !groupName.trim()}>
                    {loading ? <CircularProgress size={24} /> : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
