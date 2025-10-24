import { useEffect, useState } from 'react';
import { Box, Button, Alert, CircularProgress, Grid, Paper } from '@mui/material';
import { PlayArrow as PlayIcon } from '@mui/icons-material';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GenerationHistoryList } from '../ImageGeneration/components/GenerationHistoryList';
import RepeatControls from '../ImageGeneration/components/RepeatControls';
import GroupAssignModal from '../../components/GroupAssignModal/GroupAssignModal';

// Hooks
import { useWorkflowData } from './hooks/useWorkflowData';
import { useServerManagement } from './hooks/useServerManagement';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useImageGeneration } from './hooks/useImageGeneration';
import { useRepeatExecution } from './hooks/useRepeatExecution';
import { useServerRepeat } from './hooks/useServerRepeat';

// Components
import { WorkflowHeader } from './components/WorkflowHeader';
import { WorkflowFormFields } from './components/WorkflowFormFields';
import { GroupAssignment } from './components/GroupAssignment';
import { RepeatExecutionStatus } from './components/RepeatExecutionStatus';
import { ServerStatusList } from './components/ServerStatusList';

/**
 * 워크플로우 이미지 생성 페이지 (리팩토링 버전)
 *
 * 구조:
 * - Custom Hooks: 비즈니스 로직 분리
 * - UI Components: 재사용 가능한 컴포넌트
 * - 단일 책임 원칙 준수
 */
export default function WorkflowGeneratePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation(['workflows', 'common']);

  // 1. 워크플로우 데이터 관리
  const {
    loading,
    error,
    setError,
    workflow,
    formData,
    loadWorkflow,
    handleFieldChange,
    getPromptData
  } = useWorkflowData(id);

  // 2. 서버 관리
  const {
    servers,
    serverStatus,
    generationStatus,
    setGenerationStatus,
    loadServers,
    getConnectedServers
  } = useServerManagement();

  // 3. 그룹 관리
  const {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    loadSavedGroup,
    handleGroupSelect,
    handleRemoveGroup
  } = useGroupManagement();

  // 4. 이미지 생성
  const {
    historyRefreshKey,
    handleGenerateOnServer
  } = useImageGeneration({
    workflowId: id,
    workflow,
    formData,
    getPromptData,
    selectedGroupId,
    servers,
    setGenerationStatus,
    setError
  });

  // 5. 반복 실행 설정 관리
  const [repeatConfig, setRepeatConfig] = useState({
    enabled: false,
    count: 3,
    delaySeconds: 5
  });

  // 6. 서버별 독립 반복 실행
  const {
    serverRepeatStates,
    handleStartServerRepeat,
    handleStopServerRepeat
  } = useServerRepeat({
    servers,
    repeatConfig,
    handleGenerateOnServer
  });

  // 7. 전체 서버 동시 생성 조율
  const {
    handleGenerateOnAllServers
  } = useRepeatExecution({
    servers,
    serverStatus,
    repeatConfig,
    handleGenerateOnServer,
    handleStartServerRepeat,
    setError
  });

  // 초기 로딩
  useEffect(() => {
    loadWorkflow();
    loadServers();
    loadSavedGroup();
  }, [id]);

  // 로딩 상태
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // 워크플로우 없음
  if (!workflow) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('workflows:card.notFound')}</Alert>
      </Box>
    );
  }

  const promptData = getPromptData();
  const connectedServers = getConnectedServers();

  return (
    <Box sx={{ p: 3 }}>
      {/* 헤더 */}
      <WorkflowHeader workflow={workflow} />

      {/* 알림 */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 2열 레이아웃 */}
      <Grid container spacing={3}>
        {/* 왼쪽: 워크플로우 설정 */}
        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* 입력 폼 */}
            <WorkflowFormFields
              workflow={workflow}
              formData={formData}
              onFieldChange={handleFieldChange}
              promptData={promptData}
            />

            {/* 그룹 할당 */}
            <GroupAssignment
              selectedGroup={selectedGroup}
              onOpenModal={() => setGroupModalOpen(true)}
              onRemove={handleRemoveGroup}
            />

            {/* 반복 실행 설정 */}
            <Paper sx={{ p: 3 }}>
              <RepeatControls
                config={repeatConfig}
                state={{
                  isRunning: Object.keys(serverRepeatStates).length > 0,
                  currentIteration: 0,
                  totalIterations: 0
                }}
                onConfigChange={setRepeatConfig}
                onStop={() => {
                  // 모든 서버 반복 중지
                  Object.keys(serverRepeatStates).forEach(serverId => {
                    handleStopServerRepeat(parseInt(serverId));
                  });
                }}
                namespace="workflows"
              />
            </Paper>

            {/* 모든 서버 동시 생성 버튼 */}
            <Button
              fullWidth
              variant="contained"
              size="large"
              startIcon={<PlayIcon />}
              onClick={handleGenerateOnAllServers}
              disabled={
                connectedServers.length === 0 ||
                !workflow.is_active ||
                Object.keys(serverRepeatStates).length > 0
              }
            >
              {t('workflows:generate.generateAll', { count: connectedServers.length })}
            </Button>

            {/* 반복 실행 현황 */}
            <RepeatExecutionStatus
              servers={servers}
              serverRepeatStates={serverRepeatStates}
            />

            {/* 서버 상태 */}
            <ServerStatusList
              workflow={workflow}
              servers={servers}
              serverStatus={serverStatus}
              generationStatus={generationStatus}
              serverRepeatStates={serverRepeatStates}
              onGenerate={handleGenerateOnServer}
              onStartRepeat={handleStartServerRepeat}
              onStopRepeat={handleStopServerRepeat}
            />

            {/* 워크플로우 비활성 경고 */}
            {!workflow.is_active && (
              <Alert severity="warning">
                {t('workflows:alerts.inactiveWarning')}
              </Alert>
            )}
          </Box>
        </Grid>

        {/* 오른쪽: 히스토리 목록 */}
        <Grid size={{ xs: 12, md: 12, lg: 8 }}>
          <GenerationHistoryList
            key={historyRefreshKey}
            serviceType="comfyui"
            workflowId={parseInt(id!)}
          />
        </Grid>
      </Grid>

      {/* 그룹 선택 모달 */}
      <GroupAssignModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        selectedImageCount={1}
        onAssign={handleGroupSelect}
      />
    </Box>
  );
}
