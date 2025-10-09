const fs = require('fs');
const path = require('path');

// PNG 텍스트 청크에서 원본 메타데이터 추출
function extractRawPngMetadata(buffer) {
    const rawData = [];

    try {
        if (buffer.readUInt32BE(0) !== 0x89504E47) {
            return rawData;
        }

        let offset = 8; // PNG 시그니처 이후부터 시작

        while (offset < buffer.length - 8) {
            const chunkLength = buffer.readUInt32BE(offset);
            const chunkType = buffer.toString('ascii', offset + 4, offset + 8);

            if (chunkType === 'tEXt' || chunkType === 'zTXt') {
                const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);
                const rawText = chunkData.toString('utf8');
                rawData.push(rawText);
            }

            offset += 8 + chunkLength + 4;
        }
    } catch (error) {
        console.error('PNG 파싱 오류:', error);
    }

    return rawData;
}

// AI 메타데이터 파싱 함수
function parseAIMetadata(data) {
    const result = {};
    const negativeIndex = data.indexOf('Negative prompt:');

    if (data.startsWith('parameters')) {
        const positiveStart = 'parameters'.length;
        const positiveEnd = negativeIndex > -1 ? negativeIndex : data.length;
        result.positive_prompt = data.substring(positiveStart, positiveEnd).trim();
    }

    const negativeMatch = data.match(/Negative prompt:\s*([^\n\r]+?)(?=\s*Steps:|$)/);
    if (negativeMatch) {
        result.negative_prompt = negativeMatch[1].trim();
    }

    const stepsIndex = data.indexOf('Steps:');
    if (stepsIndex > -1) {
        const parameterSection = data.substring(stepsIndex);

        const stepsMatch = parameterSection.match(/Steps:\s*(\d+)/);
        if (stepsMatch) result.steps = parseInt(stepsMatch[1]);

        const samplerMatch = parameterSection.match(/Sampler:\s*([^,]+)/);
        if (samplerMatch) result.sampler = samplerMatch[1].trim();

        const cfgMatch = parameterSection.match(/CFG scale:\s*([\d.]+)/);
        if (cfgMatch) result.cfg_scale = parseFloat(cfgMatch[1]);

        const seedMatch = parameterSection.match(/Seed:\s*(\d+)/);
        if (seedMatch) result.seed = seedMatch[1];

        const sizeMatch = parameterSection.match(/Size:\s*(\d+x\d+)/);
        if (sizeMatch) {
            const [width, height] = sizeMatch[1].split('x').map(Number);
            result.width = width;
            result.height = height;
        }

        const modelMatch = parameterSection.match(/Model:\s*([^,]+)/);
        if (modelMatch) result.model = modelMatch[1].trim();

        const hashMatch = parameterSection.match(/Model hash:\s*([^,]+)/);
        if (hashMatch) result.model_hash = hashMatch[1].trim();

        const denoisingMatch = parameterSection.match(/Denoising strength:\s*([\d.]+)/);
        if (denoisingMatch) result.denoising_strength = parseFloat(denoisingMatch[1]);

        const clipMatch = parameterSection.match(/Clip skip:\s*(\d+)/);
        if (clipMatch) result.clip_skip = parseInt(clipMatch[1]);

        const loraMatch = parameterSection.match(/Lora hashes:\s*"([^"]+)"/);
        if (loraMatch) {
            result.lora_hashes = loraMatch[1];
        }

        const versionMatch = parameterSection.match(/Version:\s*([^,]+)/);
        if (versionMatch) result.version = versionMatch[1].trim();
    }

    return result;
}

function extractLoRAInfo(positivePrompt) {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras = [];
    let match;

    while ((match = loraRegex.exec(positivePrompt)) !== null) {
        loras.push({
            name: match[1],
            weight: parseFloat(match[2])
        });
    }

    return loras;
}

// 실제 이미지에서 메타데이터 추출 및 파싱 테스트
async function runTests() {
    console.log('=== 실제 이미지에서 AI 메타데이터 추출 및 파싱 테스트 ===\n');

    const testImages = [
        './uploads/test.png',
        './uploads/sample.png',
        './uploads/comfyui.png',
        './uploads/ai_image.png'
    ];

    for (const imagePath of testImages) {
        if (fs.existsSync(imagePath)) {
            console.log(`=== ${path.basename(imagePath)} 분석 ===`);
            try {
                const buffer = fs.readFileSync(imagePath);
                const rawData = extractRawPngMetadata(buffer);

                if (rawData.length === 0) {
                    console.log('메타데이터가 없는 이미지입니다.\n');
                    continue;
                }

                console.log(`추출된 원본 메타데이터 (${rawData.length}개):`);
                rawData.forEach((data, index) => {
                    // AI 메타데이터인지 확인하고 파싱 (parameters로 시작하는 것만)
                    if (data.includes('parameters') && data.includes('Steps:')) {
                        console.log(`\n--- AI 메타데이터 발견! (원본 데이터 ${index + 1}) ---`);
                        console.log('파싱 결과:');
                        const metadata = parseAIMetadata(data);
                        console.log(JSON.stringify(metadata, null, 2));

                        if (metadata.positive_prompt) {
                            const loras = extractLoRAInfo(metadata.positive_prompt);
                            if (loras.length > 0) {
                                console.log('\nLoRA 정보:');
                                console.log(JSON.stringify(loras, null, 2));
                            }
                        }
                    }
                });

            } catch (error) {
                console.log('추출 실패:', error.message);
            }
            console.log('\n' + '='.repeat(50) + '\n');
        } else {
            console.log(`${imagePath} 파일이 존재하지 않습니다.`);
        }
    }

    // uploads 폴더의 모든 PNG 파일 검사
    if (fs.existsSync('./uploads')) {
        const files = fs.readdirSync('./uploads').filter(file => file.endsWith('.png'));
        console.log(`\n=== uploads 폴더의 PNG 파일들 (${files.length}개) ===`);

        for (const file of files) {
            const filePath = path.join('./uploads', file);
            try {
                const buffer = fs.readFileSync(filePath);
                const rawData = extractRawPngMetadata(buffer);

                if (rawData.length > 0) {
                    console.log(`\n${file}: 메타데이터 ${rawData.length}개 발견`);
                    rawData.forEach((data, index) => {
                        if (data.includes('parameters') || data.includes('Steps:')) {
                            console.log(`  AI 메타데이터 발견! (청크 ${index + 1})`);
                        }
                    });
                }
            } catch (error) {
                console.log(`${file}: 오류 - ${error.message}`);
            }
        }
    }
}

runTests().catch(console.error);