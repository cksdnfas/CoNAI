// 필요한 라이브러리를 가져옵니다.
// 실행 전 터미널에 'npm install png-chunks-extract exif-parser'를 입력해 설치해야 합니다.
const fs = require('fs').promises;
const path = require('path');
const pngChunksExtract = require('png-chunks-extract');
const ExifParser = require('exif-parser');

// -----------------------------------------------------------------------------
// ▼▼▼ 이미지 메타데이터 처리 로직 ▼▼▼
// -----------------------------------------------------------------------------

/**
 * ComfyUI 워크플로우(JSON)에서 주요 정보를 파싱합니다.
 * @param {object} workflow - 파싱된 워크플로우 JSON 객체
 * @returns {object} 추출된 AI 정보 객체
 */
function parseComfyUI(workflow) {
    const info = {
        ai_tool: 'ComfyUI',
        prompt: '',
        negative_prompt: '',
        model: '',
        seed: null,
        steps: null,
        cfg_scale: null,
        sampler: '',
        lora_models: [],
    };

    const nodes = Object.values(workflow);

    const kSamplerNode = nodes.find(node => ['KSampler', 'KSamplerAdvanced'].includes(node.class_type));
    if (kSamplerNode) {
        info.seed = kSamplerNode.inputs.seed;
        info.steps = kSamplerNode.inputs.steps;
        info.cfg_scale = kSamplerNode.inputs.cfg;
        info.sampler = kSamplerNode.inputs.sampler_name;

        try {
            const positiveNodeId = kSamplerNode.inputs.positive[0].toString();
            const negativeNodeId = kSamplerNode.inputs.negative[0].toString();
            
            info.prompt = workflow[positiveNodeId].inputs.text;
            info.negative_prompt = workflow[negativeNodeId].inputs.text;
        } catch (e) {
            console.warn("KSampler에서 프롬프트 노드를 직접 추적하지 못했습니다. 다른 방법으로 검색합니다.");
            const promptNodes = nodes.filter(node => node.class_type === 'CLIPTextEncode');
            if (promptNodes.length > 0) info.prompt = promptNodes[0].inputs.text;
            if (promptNodes.length > 1) info.negative_prompt = promptNodes[1].inputs.text;
        }
    }
    
    const modelLoaderNode = nodes.find(node => ['CheckpointLoaderSimple', 'CheckpointLoader'].includes(node.class_type));
    if (modelLoaderNode) {
        info.model = path.basename(modelLoaderNode.inputs.ckpt_name);
    }

    const loraRegex = /<lora:([^:>]+)(?::([0-9.]+))?>/gi;
    const matches = [...info.prompt.matchAll(loraRegex)];
    info.lora_models = matches.map(match => `${match[1]}${match[2] ? `:${match[2]}` : ''}`);

    return info;
}

/**
 * Stable Diffusion WebUI (A1111)의 파라미터(텍스트)에서 주요 정보를 파싱합니다.
 * @param {string} params - 파라미터 텍스트
 * @returns {object} 추출된 AI 정보 객체
 */
function parseA1111(params) {
    const info = {
        ai_tool: 'A1111',
        prompt: '',
        negative_prompt: '',
        model: '',
        seed: null,
        steps: null,
        cfg_scale: null,
        sampler: '',
        lora_models: [],
    };
    
    const negPromptIndex = params.indexOf('Negative prompt:');
    const metadataIndex = params.lastIndexOf('Steps:');

    if (negPromptIndex > -1) {
        info.prompt = params.substring(0, negPromptIndex).trim();
        info.negative_prompt = params.substring(negPromptIndex + 'Negative prompt:'.length, metadataIndex).trim();
    } else {
        info.prompt = params.substring(0, metadataIndex).trim();
    }

    const metadataLine = params.substring(metadataIndex);
    const getMetaValue = (key) => {
        const match = metadataLine.match(new RegExp(`${key}:\\s*([^,]+)`));
        return match ? match[1].trim() : null;
    };
    
    info.steps = parseInt(getMetaValue('Steps'), 10);
    info.sampler = getMetaValue('Sampler');
    info.cfg_scale = parseFloat(getMetaValue('CFG scale'));
    info.seed = parseInt(getMetaValue('Seed'), 10);
    info.model = getMetaValue('Model') || getMetaValue('Model hash');

    const loraRegex = /<lora:([^:>]+)(?::([0-9.]+))?>/gi;
    const matches = [...info.prompt.matchAll(loraRegex)];
    info.lora_models = matches.map(match => `${match[1]}${match[2] ? `:${match[2]}` : ''}`);

    return info;
}

/**
 * 이미지 파일 경로를 받아 AI 생성 메타데이터를 추출합니다.
 * @param {string} imagePath - 이미지 파일의 경로
 * @returns {Promise<object|null>} 추출된 메타데이터 객체. 없으면 null 반환.
 */
async function extractMetadata(imagePath) {
    try {
        const buffer = await fs.readFile(imagePath);
        const ext = path.extname(imagePath).toLowerCase();
        let ai_info = null;

        if (ext === '.png') {
            const chunks = pngChunksExtract(buffer);
            const textChunks = chunks.filter(chunk => chunk.name === 'tEXt').map(chunk => {
                const nullSeparatorIndex = chunk.data.indexOf(0);
                const keyword = chunk.data.toString('utf8', 0, nullSeparatorIndex);
                const text = chunk.data.toString('utf8', nullSeparatorIndex + 1);
                return { keyword, text };
            });

            const comfyChunk = textChunks.find(c => c.keyword === 'prompt');
            const a1111Chunk = textChunks.find(c => c.keyword === 'parameters');

            if (comfyChunk) {
                const workflow = JSON.parse(comfyChunk.text);
                ai_info = parseComfyUI(workflow);
            } else if (a1111Chunk) {
                ai_info = parseA1111(a1111Chunk.text);
            }

        } else if (ext === '.jpg' || ext === '.jpeg') {
            const parser = ExifParser.create(buffer);
            const result = parser.parse();
            const userComment = result.tags.UserComment;
            if (userComment) {
                const params = Buffer.from(userComment).toString('utf16le', 8);
                ai_info = parseA1111(params);
            }
        }
        
        return ai_info ? { ai_info } : { ai_info: { ai_tool: 'Unknown' } };

    } catch (error) {
        console.error(`'${imagePath}' 처리 실패:`, error.message);
        return { ai_info: { ai_tool: 'Error', error: error.message } };
    }
}


// -----------------------------------------------------------------------------
// ▼▼▼ 실제 프로그램 실행 부분 ▼▼▼
// -----------------------------------------------------------------------------
async function run() {
    console.log('=== 이미지 메타데이터 추출기 ===\n');

    // 검사할 이미지 파일 목록
    // 이미지 경로는 이 스크립트 파일이 있는 위치를 기준으로 합니다.
    const testImages = [
        './uploads/test.png',
        './uploads/sample.jpg',
        './uploads/comfyui.png' 
    ];

    for (const imagePath of testImages) {
        // fs.access 로 파일 존재 여부 확인
        try {
            await fs.access(imagePath);
        } catch (error) {
            console.log(`'${imagePath}' 파일을 찾을 수 없습니다. 건너뜁니다.\n`);
            continue;
        }
        
        console.log(`🔎 [${path.basename(imagePath)}] 파일 분석 중...`);
        const metadata = await extractMetadata(imagePath);
        
        if (metadata && metadata.ai_info && metadata.ai_info.ai_tool !== 'Unknown' && metadata.ai_info.ai_tool !== 'Error') {
            const { ai_info } = metadata;
            console.log(`   - AI 도구: ${ai_info.ai_tool}`);
            console.log(`   - 모델: ${ai_info.model || 'N/A'}`);
            console.log(`   - 프롬프트: ${ai_info.prompt || '없음'}`);
            if (ai_info.negative_prompt) {
                console.log(`   - 네거티브 프롬프트: ${ai_info.negative_prompt}`);
            }
            if (ai_info.steps) console.log(`   - 스텝: ${ai_info.steps}`);
            if (ai_info.cfg_scale) console.log(`   - CFG: ${ai_info.cfg_scale}`);
            if (ai_info.sampler) console.log(`   - 샘플러: ${ai_info.sampler}`);
            if (ai_info.seed) console.log(`   - 시드: ${ai_info.seed}`);
            if (ai_info.lora_models && ai_info.lora_models.length > 0) {
                console.log(`   - LoRA 모델: ${ai_info.lora_models.join(', ')}`);
            }
        } else {
            console.log("   >> AI 생성 정보를 찾을 수 없거나 분석에 실패했습니다.");
        }
        console.log(); // 줄바꿈
    }
}

// 스크립트 실행
run().catch(console.error);