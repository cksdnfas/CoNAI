import { Box, Typography, Paper, Alert, Divider, Chip, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { Info as InfoIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';

export function MarkedFieldsGuide() {
  return (
    <Paper sx={{ mb: 3 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoIcon color="info" />
            <Typography variant="h6">
              Marked Fields 사용 가이드
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Divider sx={{ mb: 2 }} />

      <Typography variant="body1" gutterBottom>
        <strong>Marked Fields란?</strong>
      </Typography>
      <Typography variant="body2" paragraph>
        이미지 생성 시 사용자가 변경할 수 있는 필드를 정의합니다.
        예를 들어, 프롬프트, 시드 값, Steps, CFG 등을 동적으로 입력받을 수 있습니다.
      </Typography>

      <Typography variant="body1" gutterBottom sx={{ mt: 2 }}>
        <strong>JSON Path 찾는 방법:</strong>
      </Typography>
      <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
        <li>
          <Typography variant="body2">
            ComfyUI에서 워크플로우를 만든 후 <Chip label="Save (API Format)" size="small" /> 버튼 클릭
          </Typography>
        </li>
        <li>
          <Typography variant="body2">
            JSON 파일을 열어서 노드 번호와 입력 필드명 확인
          </Typography>
        </li>
        <li>
          <Typography variant="body2">
            경로 형식: <code>[노드번호].inputs.[필드명]</code>
          </Typography>
        </li>
      </Box>

      <Alert severity="success" sx={{ mt: 2 }}>
        <Typography variant="body2" component="div">
          <strong>실제 예시:</strong>
          <br /><br />

          <strong>1. 프롬프트 필드 (CLIPTextEncode 노드 #6)</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>필드 ID:</strong> prompt_positive</li>
            <li><strong>라벨:</strong> 프롬프트</li>
            <li><strong>타입:</strong> 긴 텍스트 (textarea)</li>
            <li><strong>JSON Path:</strong> 6.inputs.text</li>
            <li><strong>기본값:</strong> a beautiful landscape</li>
          </ul>
          <br />

          <strong>2. 시드 값 (KSampler 노드 #3)</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>필드 ID:</strong> seed</li>
            <li><strong>라벨:</strong> Seed</li>
            <li><strong>타입:</strong> 숫자 (number)</li>
            <li><strong>JSON Path:</strong> 3.inputs.seed</li>
            <li><strong>기본값:</strong> 123456</li>
          </ul>
          <br />

          <strong>3. Steps (KSampler 노드 #3)</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>필드 ID:</strong> steps</li>
            <li><strong>라벨:</strong> Steps</li>
            <li><strong>타입:</strong> 숫자 (number)</li>
            <li><strong>JSON Path:</strong> 3.inputs.steps</li>
            <li><strong>기본값:</strong> 20</li>
            <li><strong>최소값:</strong> 1</li>
            <li><strong>최대값:</strong> 150</li>
          </ul>
          <br />

          <strong>4. Sampler (KSampler 노드 #3)</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>필드 ID:</strong> sampler_name</li>
            <li><strong>라벨:</strong> Sampler</li>
            <li><strong>타입:</strong> 선택 (select)</li>
            <li><strong>JSON Path:</strong> 3.inputs.sampler_name</li>
            <li><strong>선택 옵션:</strong> euler, euler_ancestral, dpm++ 2m, ddim</li>
          </ul>
        </Typography>
      </Alert>

      <Alert severity="info" sx={{ mt: 2 }}>
        <Typography variant="body2">
          <strong>💡 팁:</strong> JSON Path는 Workflow JSON의 구조를 그대로 따릅니다.
          <br />
          예를 들어 JSON이 <code>{`{"3": {"inputs": {"seed": 123}}}`}</code> 형태라면
          <br />
          JSON Path는 <code>3.inputs.seed</code>가 됩니다.
        </Typography>
      </Alert>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
