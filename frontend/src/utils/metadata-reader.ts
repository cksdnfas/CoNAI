/**
 * Client-side metadata reader
 * Extracts AI metadata from images without uploading to server
 * Based on backend/src/services/metadata implementation
 */

import exifr from 'exifr'
import { extractStealthPngInfo } from '@/utils/stealth-png-extractor'

export interface RawMetadata {
  [key: string]: any
}

export interface ParsedMetadata {
  aiTool?: string
  prompt?: string
  positivePrompt?: string
  negativePrompt?: string
  parameters?: {
    [key: string]: any
  }
  rawMetadata: RawMetadata
}

interface AIMetadata {
  ai_tool?: string
  prompt?: string
  positive_prompt?: string
  negative_prompt?: string
  steps?: number
  cfg_scale?: number
  seed?: number
  sampler?: string
  scheduler?: string
  width?: number
  height?: number
  model?: string
  [key: string]: any
}

interface RawPngMetadata {
  textChunks: { [key: string]: string }
  rawStrings: string[]
}

/**
 * PNG Extractor - Extract metadata from PNG tEXt/zTXt chunks
 */
class PngExtractor {
  static extract(buffer: ArrayBuffer): AIMetadata {
    try {
      const { textChunks, rawStrings } = this.extractRawPngMetadata(buffer)

      // Check for NovelAI format
      if (textChunks.Software === 'NovelAI' || textChunks.Source?.includes('NovelAI')) {
        console.log('✅ NovelAI image detected in PNG')

        // Will be parsed by NovelAIParser
        if (textChunks.Comment) {
          return { Comment: textChunks.Comment, Source: textChunks.Source }
        }
      }

      // Check for WebUI/SD format in raw strings
      for (const data of rawStrings) {
        if (data.includes('parameters') && data.includes('Steps:')) {
          // Will be parsed by WebUIParser
          return { parameters: data }
        }
      }

      // Return raw data for further processing
      return { textChunks, rawStrings }
    } catch (error) {
      console.warn('PNG metadata extraction error:', error)
      return {}
    }
  }

  private static extractRawPngMetadata(buffer: ArrayBuffer): RawPngMetadata {
    const textChunks: { [key: string]: string } = {}
    const rawStrings: string[] = []

    try {
      const data = new Uint8Array(buffer)

      // Verify PNG signature (0x89504E47)
      if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
        return { textChunks, rawStrings }
      }

      let offset = 8 // Skip PNG signature

      while (offset < data.length - 8) {
        // Read chunk length (big-endian)
        const chunkLength = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

        // Read chunk type
        const chunkType = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])

        // Process tEXt and zTXt chunks
        if (chunkType === 'tEXt' || chunkType === 'zTXt') {
          const chunkData = data.slice(offset + 8, offset + 8 + chunkLength)
          const rawText = new TextDecoder('utf-8').decode(chunkData)
          rawStrings.push(rawText)

          // Parse key-value structure (null-separated)
          const nullIndex = rawText.indexOf('\0')
          if (nullIndex > 0) {
            const key = rawText.substring(0, nullIndex)
            const value = rawText.substring(nullIndex + 1)
            textChunks[key] = value
          }
        }

        offset += 8 + chunkLength + 4 // length + type + data + CRC
      }
    } catch (error) {
      console.error('PNG parsing error:', error)
    }

    return { textChunks, rawStrings }
  }
}

/**
 * NovelAI Parser
 */
class NovelAIParser {
  static isNovelAIFormat(data: any): boolean {
    console.log('🔍 [NovelAIParser.isNovelAIFormat] Checking data type:', typeof data)

    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data)
        console.log('📦 [NovelAIParser] Parsed JSON keys:', Object.keys(parsed))

        // Check Comment field first (Stealth PNG structure)
        if (parsed.Comment) {
          console.log('📄 [NovelAIParser] Found Comment field')
          try {
            const commentData = JSON.parse(parsed.Comment)
            const hasNAI = this.hasNovelAIFields(commentData)
            console.log('✅ [NovelAIParser] Comment contains NAI fields:', hasNAI)
            if (hasNAI) return true
          } catch {
            console.warn('⚠️ [NovelAIParser] Comment field is not valid JSON')
          }
        }

        // Direct NAI fields check
        const hasDirectNAI = this.hasNovelAIFields(parsed)
        console.log('📦 [NovelAIParser] Direct NAI fields:', hasDirectNAI)
        return hasDirectNAI
      } catch (e) {
        console.warn('⚠️ [NovelAIParser] JSON parse failed:', e)
        return false
      }
    }

    if (typeof data === 'object' && data !== null) {
      console.log('📦 [NovelAIParser] Checking object data, keys:', Object.keys(data))

      if (this.hasCommentField(data)) {
        console.log('✅ [NovelAIParser] Object has valid Comment field')
        return true
      }

      const hasNAI = this.hasNovelAIFields(data)
      console.log('📦 [NovelAIParser] Object has NAI fields:', hasNAI)
      return hasNAI
    }

    console.log('❌ [NovelAIParser] Not a NovelAI format')
    return false
  }

  private static hasCommentField(obj: any): boolean {
    if (!obj.Comment) {
      return false
    }

    try {
      const commentData = JSON.parse(obj.Comment)
      return this.hasNovelAIFields(commentData)
    } catch {
      return false
    }
  }

  private static hasNovelAIFields(obj: any): boolean {
    return obj && (obj.prompt !== undefined || obj.v4_prompt !== undefined || obj.uc !== undefined || obj.scale !== undefined || obj.noise_schedule !== undefined)
  }

  static parse(data: any): AIMetadata {
    console.log('🔍 [NovelAIParser.parse] Input type:', typeof data)

    try {
      let naiData: any
      let topLevelData: any = data

      // Handle string input (from Stealth PNG)
      if (typeof data === 'string') {
        console.log('📄 [NovelAIParser] Parsing string input')
        topLevelData = JSON.parse(data)
        console.log('📦 [NovelAIParser] Top-level keys:', Object.keys(topLevelData))

        if (topLevelData.Comment) {
          console.log('📄 [NovelAIParser] Parsing Comment field')
          try {
            naiData = JSON.parse(topLevelData.Comment)
            console.log('✅ [NovelAIParser] Successfully parsed Comment from Stealth PNG')
            console.log('📦 [NovelAIParser] NAI data keys:', Object.keys(naiData))
          } catch (e) {
            console.warn('⚠️ [NovelAIParser] Failed to parse Comment field:', e)
            naiData = topLevelData
          }
        } else {
          console.log('📄 [NovelAIParser] No Comment field, using top-level data')
          naiData = topLevelData
        }
      } else if (data.Comment) {
        // Object with Comment field
        console.log('📄 [NovelAIParser] Object has Comment field')
        topLevelData = data
        try {
          naiData = JSON.parse(data.Comment)
          console.log('✅ [NovelAIParser] Successfully parsed Comment field')
        } catch (e) {
          console.warn('⚠️ [NovelAIParser] Failed to parse Comment field:', e)
          naiData = data
        }
      } else {
        console.log('📄 [NovelAIParser] Using data directly')
        naiData = data
      }

      const aiInfo: AIMetadata = {}

      // Positive prompt (v4_prompt takes priority)
      if (naiData.v4_prompt?.caption?.base_caption) {
        aiInfo.positive_prompt = naiData.v4_prompt.caption.base_caption
        aiInfo.prompt = aiInfo.positive_prompt
      } else if (naiData.prompt) {
        aiInfo.positive_prompt = naiData.prompt
        aiInfo.prompt = naiData.prompt
      }

      // Negative prompt (v4_negative_prompt takes priority)
      if (naiData.v4_negative_prompt?.caption?.base_caption) {
        aiInfo.negative_prompt = naiData.v4_negative_prompt.caption.base_caption
      } else if (naiData.uc) {
        aiInfo.negative_prompt = naiData.uc
      }

      // Generation parameters
      if (naiData.steps) aiInfo.steps = naiData.steps
      if (naiData.scale) aiInfo.cfg_scale = naiData.scale
      if (naiData.seed) aiInfo.seed = Number(naiData.seed)
      if (naiData.sampler) aiInfo.sampler = naiData.sampler
      if (naiData.noise_schedule) aiInfo.scheduler = naiData.noise_schedule
      if (naiData.width) aiInfo.width = naiData.width
      if (naiData.height) aiInfo.height = naiData.height

      // Extract model from Source field
      if (topLevelData.Source) {
        const sourceMatch = topLevelData.Source.match(/NovelAI Diffusion (V[\d.]+)/i)
        if (sourceMatch) {
          aiInfo.model = `NovelAI Diffusion ${sourceMatch[1]}`
        }
      }

      // Mark as NovelAI
      aiInfo.ai_tool = 'NovelAI'

      console.log('✅ [NovelAIParser] Successfully parsed:', {
        hasPrompt: !!aiInfo.prompt,
        hasNegativePrompt: !!aiInfo.negative_prompt,
        promptLength: aiInfo.prompt?.length || 0,
        negativePromptLength: aiInfo.negative_prompt?.length || 0,
        steps: aiInfo.steps,
        scale: aiInfo.cfg_scale,
        sampler: aiInfo.sampler,
        model: aiInfo.model,
      })

      return aiInfo
    } catch (error) {
      console.error('❌ [NovelAIParser] Parse error:', error)
      return {}
    }
  }
}

/**
 * WebUI Parser
 */
class WebUIParser {
  static isWebUIFormat(data: any): boolean {
    if (typeof data === 'string') {
      return data.includes('parameters') || (data.includes('Steps:') && data.includes('Sampler:'))
    }

    if (typeof data === 'object' && data !== null) {
      return data.parameters !== undefined
    }

    return false
  }

  static parse(data: any): AIMetadata {
    try {
      let parametersText: string

      if (typeof data === 'string') {
        parametersText = data
      } else if (data.parameters) {
        parametersText = data.parameters
      } else {
        return {}
      }

      if (parametersText.startsWith('parameters')) {
        parametersText = parametersText.substring('parameters'.length)
      }

      return this.parseParametersText(parametersText)
    } catch (error) {
      console.warn('WebUI parsing error:', error)
      return {}
    }
  }

  private static parseParametersText(text: string): AIMetadata {
    const aiInfo: AIMetadata = {}

    const lines = text.split(/\r?\n/)

    // Find "Negative prompt:" line
    let negPromptIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Negative prompt:')) {
        negPromptIndex = i
        break
      }
    }

    // Extract prompts
    if (negPromptIndex > 0) {
      const positiveLines = lines.slice(0, negPromptIndex)
      aiInfo.positive_prompt = positiveLines.join('\n').trim().replace(/\u0000/g, '')
      aiInfo.prompt = aiInfo.positive_prompt

      const negLine = lines[negPromptIndex]
      aiInfo.negative_prompt = negLine.substring('Negative prompt:'.length).trim().replace(/\u0000/g, '')

      const optionLines = lines.slice(negPromptIndex + 1)
      this.parseOptionLines(optionLines, aiInfo)
    } else {
      aiInfo.positive_prompt = text.trim().replace(/\u0000/g, '')
      aiInfo.prompt = aiInfo.positive_prompt
      aiInfo.negative_prompt = ''
    }

    return aiInfo
  }

  private static parseOptionLines(lines: string[], aiInfo: AIMetadata): void {
    const optionText = lines.join(' ').trim()
    if (!optionText) return

    const parts = optionText.split(',')

    for (const part of parts) {
      const trimmedPart = part.trim()
      if (!trimmedPart || !trimmedPart.includes(':')) continue

      const colonIndex = trimmedPart.indexOf(':')
      const key = trimmedPart.substring(0, colonIndex).trim()
      const value = trimmedPart.substring(colonIndex + 1).trim().replace(/\u0000/g, '')

      this.parseOptionField(key, value, aiInfo)
    }
  }

  private static parseOptionField(key: string, value: string, aiInfo: AIMetadata): void {
    const keyLower = key.toLowerCase()

    let numValue: number | undefined
    try {
      if (value.includes('.')) {
        numValue = parseFloat(value)
      } else {
        const parsed = parseInt(value)
        if (!isNaN(parsed)) {
          numValue = parsed
        }
      }
    } catch {
      // Keep as string
    }

    switch (keyLower) {
      case 'steps':
        aiInfo.steps = numValue
        break
      case 'sampler':
        aiInfo.sampler = value
        break
      case 'cfg scale':
        aiInfo.cfg_scale = numValue
        break
      case 'seed':
        aiInfo.seed = numValue
        break
      case 'size': {
        const [width, height] = value.split('x').map(Number)
        if (width && height) {
          aiInfo.width = width
          aiInfo.height = height
        }
        break
      }
      case 'model':
        aiInfo.model = value
        break
      case 'model hash':
        aiInfo.model_hash = value
        break
      case 'denoising strength':
        aiInfo.denoising_strength = numValue
        break
      case 'clip skip':
        aiInfo.clip_skip = numValue
        break
      default:
        aiInfo[key] = numValue !== undefined ? numValue : value
        break
    }
  }
}

/**
 * Metadata Extractor - Main extraction function
 */
async function extractFromFile(file: File): Promise<AIMetadata> {
  const rawMetadata: RawMetadata = {}

  // Step 1: Extract EXIF data
  try {
    const exif = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      interop: true,
      ifd1: true,
      iptc: true,
      jfif: true,
      ihdr: true,
    })

    if (exif) {
      Object.assign(rawMetadata, exif)
    }
  } catch (error) {
    console.warn('EXIF extraction failed:', error)
  }

  // Step 2: Primary extraction for PNG
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    const buffer = await file.arrayBuffer()
    const aiInfo = PngExtractor.extract(buffer)

    // Step 3: Parse raw data
    let parsedData = parseRawData(aiInfo)

    // Step 4: Check if prompt was extracted (including trim check)
    const hasPrompt = Boolean((parsedData.prompt && parsedData.prompt.trim()) || (parsedData.positive_prompt && parsedData.positive_prompt.trim()))

    console.log('🔍 [extractFromFile] Primary extraction result:', {
      hasPrompt,
      promptLength: parsedData.prompt?.length || 0,
      positivePromptLength: parsedData.positive_prompt?.length || 0,
      promptPreview: (parsedData.prompt || parsedData.positive_prompt)?.substring(0, 50),
    })

    // Step 5: If no prompt, try Stealth PNG Info
    if (!hasPrompt) {
      console.log('⚠️ [extractFromFile] Primary extraction failed - attempting Stealth PNG Info')
      const stealthData = await extractStealthPngInfo(file)

      if (stealthData) {
        console.log('✅ [extractFromFile] Stealth PNG Info extracted successfully!')
        console.log('📊 [extractFromFile] Stealth data length:', stealthData.length)
        console.log('📄 [extractFromFile] First 200 chars:', stealthData.substring(0, 200))

        rawMetadata['Stealth PNG Info'] = stealthData

        // Parse Stealth data
        const stealthParsed = parseRawData({ stealthData })

        console.log('📦 [extractFromFile] Stealth parse result:', {
          hasPrompt: !!stealthParsed.prompt,
          hasPositivePrompt: !!stealthParsed.positive_prompt,
          promptLength: stealthParsed.prompt?.length || 0,
        })

        if (stealthParsed.prompt || stealthParsed.positive_prompt) {
          console.log('✅ [extractFromFile] Using Stealth PNG data')
          parsedData = stealthParsed
        } else {
          console.log('⚠️ [extractFromFile] Stealth data parsing failed - no valid prompts')
        }
      } else {
        console.log('❌ [extractFromFile] Stealth PNG Info not found')
      }
    }

    return { ...rawMetadata, ...parsedData }
  }

  return rawMetadata
}

/**
 * Parse raw data using appropriate parser
 */
function parseRawData(rawData: any): AIMetadata {
  console.log('🔍 [parseRawData] Input type:', typeof rawData, {
    hasStealthData: !!rawData.stealthData,
    stealthDataLength: rawData.stealthData?.length || 0,
    stealthDataPreview: rawData.stealthData?.substring(0, 100),
  })

  // Try NovelAI parser
  if (NovelAIParser.isNovelAIFormat(rawData)) {
    console.log('📦 [parseRawData] Parsing as NovelAI format')
    return NovelAIParser.parse(rawData)
  }

  // Try WebUI parser
  if (WebUIParser.isWebUIFormat(rawData)) {
    console.log('📦 [parseRawData] Parsing as WebUI format')
    return WebUIParser.parse(rawData)
  }

  // Try parsing stealth data if present
  if (rawData.stealthData) {
    console.log('🔍 [parseRawData] Attempting to parse stealth data...')

    // Try NovelAI
    const isNovelAI = NovelAIParser.isNovelAIFormat(rawData.stealthData)
    console.log('🔍 [parseRawData] Is NovelAI format?', isNovelAI)

    if (isNovelAI) {
      console.log('📦 [parseRawData] Parsing stealth data as NovelAI format')
      const result = NovelAIParser.parse(rawData.stealthData)
      console.log('✅ [parseRawData] NovelAI parse result:', {
        hasPrompt: !!result.prompt,
        hasPositivePrompt: !!result.positive_prompt,
        hasNegativePrompt: !!result.negative_prompt,
      })
      return result
    }

    // Try WebUI
    const isWebUI = WebUIParser.isWebUIFormat(rawData.stealthData)
    console.log('🔍 [parseRawData] Is WebUI format?', isWebUI)

    if (isWebUI) {
      console.log('📦 [parseRawData] Parsing stealth data as WebUI format')
      const result = WebUIParser.parse(rawData.stealthData)
      console.log('✅ [parseRawData] WebUI parse result:', {
        hasPrompt: !!result.prompt,
        hasPositivePrompt: !!result.positive_prompt,
        hasNegativePrompt: !!result.negative_prompt,
      })
      return result
    }

    console.log('❌ [parseRawData] Stealth data found but format not recognized')
    console.log('📄 [parseRawData] Raw stealth data sample:', rawData.stealthData.substring(0, 200))
  }

  console.log('⚠️ [parseRawData] No recognized format found')
  return {}
}

/**
 * Detect AI tool from metadata
 *
 * Supports: ComfyUI, NovelAI, WebUI (Automatic1111)
 */
function detectAITool(metadata: any): string {
  if (metadata.ai_tool) return metadata.ai_tool

  const text = JSON.stringify(metadata).toLowerCase()

  if (text.includes('comfyui') || text.includes('comfy ui')) {
    return 'ComfyUI'
  }
  if (text.includes('novelai') || text.includes('novel ai')) {
    return 'NovelAI'
  }
  if (text.includes('automatic1111') || text.includes('webui')) {
    return 'Automatic1111'
  }

  return 'Unknown'
}

/**
 * Main metadata extraction function - Public API
 */
export async function extractMetadata(file: File): Promise<ParsedMetadata> {
  try {
    const extracted = await extractFromFile(file)
    const aiTool = detectAITool(extracted)

    // Collect parameters
    const parameters: any = {}
    const excludeKeys = ['ai_tool', 'prompt', 'positive_prompt', 'negative_prompt', 'textChunks', 'rawStrings']

    for (const [key, value] of Object.entries(extracted)) {
      if (!excludeKeys.includes(key) && value !== undefined && value !== null) {
        parameters[key] = value
      }
    }

    return {
      aiTool,
      prompt: extracted.prompt,
      positivePrompt: extracted.positive_prompt || extracted.prompt,
      negativePrompt: extracted.negative_prompt,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
      rawMetadata: extracted,
    }
  } catch (error) {
    console.error('Failed to extract metadata:', error)
    return {
      aiTool: 'Unknown',
      rawMetadata: {},
    }
  }
}
