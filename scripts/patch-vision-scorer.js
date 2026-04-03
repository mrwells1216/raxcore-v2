import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const filePath = join(__dirname, '../lib/scoring/vision-scorer.ts')

let content = readFileSync(filePath, 'utf8')

// 1. Fix the import: replace createOpenAI with openai singleton
content = content.replace(
  "import { createOpenAI } from '@ai-sdk/openai'",
  "import { openai } from '@ai-sdk/openai'"
)

// 2. Replace the getVisionModel body
const oldBody = `function getVisionModel() {
  const apiKey = process.env.OPENAI_API_KEY
  const hasKey = !!apiKey

  console.log('[vision-scorer] provider check', {
    selectedProvider: 'openai',
    model: OPENAI_VISION_MODEL,
    hasOpenAIKey: hasKey,
  })

  if (!hasKey) {
    throw new Error(
      '[vision-scorer] Missing OPENAI_API_KEY — cannot score. ' +
      'Set OPENAI_API_KEY in your server environment variables.'
    )
  }

  const openai = createOpenAI({ apiKey })
  return { model: openai(OPENAI_VISION_MODEL), provider: 'openai', modelName: OPENAI_VISION_MODEL }
}`

const newBody = `function getVisionModel() {
  const hasKey = !!process.env.OPENAI_API_KEY

  console.log('[vision-scorer] provider check', {
    selectedProvider: 'openai',
    selectedModel: OPENAI_VISION_MODEL,
    providerAdapterUsed: 'openai.responses (spec v2)',
    hasOpenAIKey: hasKey,
    isFallback: false,
  })

  if (!hasKey) {
    throw new Error(
      '[vision-scorer] Missing OPENAI_API_KEY — cannot score. ' +
      'Set OPENAI_API_KEY in your server environment variables.'
    )
  }

  // openai.responses() is the AI SDK 6 / spec-v2 Responses API path.
  // Do NOT use openai('gpt-4o') — that resolves to spec v1 chat adapter and
  // throws "Unsupported model version v1 for provider openai.chat".
  return {
    model: openai.responses(OPENAI_VISION_MODEL),
    provider: 'openai',
    providerAdapter: 'openai.responses',
    modelName: OPENAI_VISION_MODEL,
  }
}`

if (!content.includes(oldBody)) {
  // If the file already has an updated import but old body, handle both cases
  const altOldBody = oldBody.replace(
    "import { createOpenAI } from '@ai-sdk/openai'",
    "import { openai } from '@ai-sdk/openai'"
  )
  if (content.includes('const openai = createOpenAI({ apiKey })')) {
    content = content.replace(
      /const apiKey = process\.env\.OPENAI_API_KEY\n  const hasKey = !!apiKey\n\n  console\.log\('\[vision-scorer\] provider check', \{[\s\S]*?hasOpenAIKey: hasKey,\n  \}\)\n\n  if \(!hasKey\) \{[\s\S]*?\}\n\n  const openai = createOpenAI\(\{ apiKey \}\)\n  return \{ model: openai\(OPENAI_VISION_MODEL\), provider: 'openai', modelName: OPENAI_VISION_MODEL \}\n\}/,
      newBody.replace('function getVisionModel() {\n  ', '')
    )
    console.log('Applied targeted regex replacement')
  } else {
    console.log('WARNING: Old body not found, file may already be patched or has unexpected content')
    console.log('Checking for old patterns...')
    console.log('Has createOpenAI:', content.includes('createOpenAI'))
    console.log('Has openai.responses:', content.includes('openai.responses'))
  }
} else {
  content = content.replace(oldBody, newBody)
  console.log('Applied direct string replacement')
}

writeFileSync(filePath, content, 'utf8')
console.log('Patch applied successfully to', filePath)
console.log('Verify: has openai.responses:', content.includes('openai.responses'))
console.log('Verify: no createOpenAI:', !content.includes('createOpenAI'))
