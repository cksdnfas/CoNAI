import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    CircularProgress,
    Alert,
    Box
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { PromptGroupWithChildren } from './utils';
import { GroupTreePanel } from './GroupTreePanel';

interface MovePromptDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (groupId: number | null) => Promise<void>;
    groups: PromptGroupWithChildren[];
    selectedCount: number;
}

export const MovePromptDialog: React.FC<MovePromptDialogProps> = ({
    open,
    onClose,
    onConfirm,
    groups,
    selectedCount
}) => {
    const { t } = useTranslation(['common', 'promptManagement']);
    const [groupId, setGroupId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    const flattenGroupIds = (nodes: PromptGroupWithChildren[]): number[] => {
        let ids: number[] = [];
        for (const node of nodes) {
            ids.push(node.id);
            if (node.children) {
                ids = [...ids, ...flattenGroupIds(node.children)];
            }
        }
        return ids;
    };

    const handleConfirm = async () => {
        setLoading(true);
        setError(null);
        try {
            await onConfirm(groupId);
            onClose();
        } catch (err) {
            console.error(err);
            setError('Failed to move prompts');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={() => !loading && onClose()} maxWidth="xs" fullWidth>
            <DialogTitle>
                Move {selectedCount} Prompts
            </DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <Box sx={{ mt: 1, height: 400, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                    <GroupTreePanel
                        data={groups}
                        selectedId={groupId}
                        expandedIds={expandedIds}
                        onSelect={(node) => setGroupId(node.id)}
                        onToggle={(id) => {
                            const newExpanded = new Set(expandedIds);
                            if (newExpanded.has(id)) {
                                newExpanded.delete(id);
                            } else {
                                newExpanded.add(id);
                            }
                            setExpandedIds(newExpanded);
                        }}
                        onExpandAll={() => {
                            const allIds = new Set(flattenGroupIds(groups));
                            setExpandedIds(allIds);
                        }}
                        onCollapseAll={() => setExpandedIds(new Set())}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>Cancel</Button>
                <Button onClick={handleConfirm} variant="contained" disabled={loading || groupId === null}>
                    {loading ? <CircularProgress size={24} /> : 'Move'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
