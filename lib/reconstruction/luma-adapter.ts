import 'server-only'

import type {
  ReconstructionAsset,
  ReconstructionAssetType,
  ReconstructionInputImage,
  ReconstructionJobStatus,
} from './types'

export class LumaConfigurationError extends Error {
  constructor(message = 'Luma reconstruction is not configured.') {
    super(message)
    this.name = 'LumaConfigurationError'
  }
}

interface UnknownRecord {
  [key: string]: unknown
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numberValue) ? numberValue : null
}

function getConfig(): { apiKey: string; submitUrl: string; statusUrl: string } {
  const apiKey = process.env.LUMA_API_KEY
  const submitUrl = process.env.LUMA_RECON_SUBMIT_URL
  const statusUrl = process.env.LUMA_RECON_STATUS_URL

  if (!apiKey || !submitUrl || !statusUrl) {
    throw new LumaConfigurationError('Missing LUMA_API_KEY, LUMA_RECON_SUBMIT_URL, or LUMA_RECON_STATUS_URL.')
  }

  return { apiKey, submitUrl, statusUrl }
}

export function isLumaReconstructionConfigured(): boolean {
  return Boolean(process.env.LUMA_API_KEY && process.env.LUMA_RECON_SUBMIT_URL && process.env.LUMA_RECON_STATUS_URL)
}

export function normalizeLumaStatus(rawStatus: unknown): ReconstructionJobStatus {
  const status = String(rawStatus ?? '').toLowerCase().replace(/[\s-]+/g, '_')

  if (['queued', 'pending', 'created', 'waiting'].includes(status)) return 'queued'
  if (['uploading', 'upload'].includes(status)) return 'uploading'
  if (['processing', 'running', 'in_progress', 'generating', 'reconstructing'].includes(status)) return 'processing'
  if (['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(status)) return 'completed'
  if (['failed', 'error', 'errored'].includes(status)) return 'failed'
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'

  return 'processing'
}

function inferAssetType(url: string, hint?: string | null, mimeType?: string | null): ReconstructionAssetType {
  const lower = `${url} ${hint ?? ''} ${mimeType ?? ''}`.toLowerCase()

  if (lower.includes('splat') || lower.includes('gaussian') || lower.endsWith('.ksplat')) return 'gaussian_splat'
  if (lower.includes('mesh_glb') || lower.includes('mesh') || lower.includes('model') || lower.includes('.glb') || lower.includes('.gltf') || lower.includes('model/gltf')) return 'mesh_glb'
  if (lower.includes('point_cloud_xyz') || lower.includes('.xyz')) return 'point_cloud_xyz'
  if (lower.includes('point_cloud_csv') || lower.includes('.csv') || lower.includes('text/csv')) return 'point_cloud_csv'
  if (lower.includes('point_cloud_ply') || lower.includes('point_cloud') || lower.includes('.ply')) return 'point_cloud_ply'
  if (lower.includes('.png') || lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('image/')) return 'preview_image'

  return 'unknown'
}

function normalizeAsset(raw: unknown, index: number): ReconstructionAsset | null {
  if (typeof raw === 'string') {
    const url = raw.trim()
    if (!url) return null
    return {
      id: `luma-asset-${index}`,
      type: inferAssetType(url),
      url,
      provider: 'luma',
    }
  }

  const record = asRecord(raw)
  if (!record) return null

  const url =
    asString(record.url) ??
    asString(record.downloadUrl) ??
    asString(record.download_url) ??
    asString(record.uri) ??
    asString(record.href)

  if (!url) return null

  const fileName =
    asString(record.fileName) ??
    asString(record.filename) ??
    asString(record.name) ??
    null
  const mimeType = asString(record.mimeType) ?? asString(record.mime_type) ?? asString(record.contentType) ?? null
  const hintedType = asString(record.type) ?? asString(record.assetType) ?? asString(record.asset_type)

  return {
    id: asString(record.id) ?? `luma-asset-${index}`,
    type: hintedType ? inferAssetType(url, hintedType, mimeType) : inferAssetType(url, fileName, mimeType),
    url,
    fileName,
    mimeType,
    sizeBytes: asNumber(record.sizeBytes) ?? asNumber(record.size_bytes),
    provider: 'luma',
    metadata: { rawType: hintedType ?? null },
  }
}

function collectAssetCandidates(raw: unknown): unknown[] {
  const record = asRecord(raw)
  if (!record) return Array.isArray(raw) ? raw : []

  const candidates: unknown[] = []
  for (const key of ['assets', 'outputs', 'files', 'artifacts', 'resultAssets']) {
    const value = record[key]
    if (Array.isArray(value)) candidates.push(...value)
  }

  const result = asRecord(record.result)
  if (result) {
    for (const key of ['assets', 'outputs', 'files', 'artifacts']) {
      const value = result[key]
      if (Array.isArray(value)) candidates.push(...value)
    }
  }

  for (const key of ['meshUrl', 'mesh_url', 'glbUrl', 'glb_url', 'modelUrl', 'model_url']) {
    const value = asString(record[key]) ?? asString(result?.[key])
    if (value) candidates.push({ type: 'mesh_glb', url: value })
  }

  for (const key of ['pointCloudUrl', 'point_cloud_url', 'plyUrl', 'ply_url', 'xyzUrl', 'xyz_url']) {
    const value = asString(record[key]) ?? asString(result?.[key])
    if (value) candidates.push({ type: 'point_cloud', url: value })
  }

  for (const key of ['splatUrl', 'splat_url', 'gaussianSplatUrl', 'gaussian_splat_url']) {
    const value = asString(record[key]) ?? asString(result?.[key])
    if (value) candidates.push({ type: 'gaussian_splat', url: value })
  }

  for (const key of ['previewUrl', 'preview_url', 'thumbnailUrl', 'thumbnail_url']) {
    const value = asString(record[key]) ?? asString(result?.[key])
    if (value) candidates.push({ type: 'preview_image', url: value })
  }

  return candidates
}

export function extractLumaAssets(raw: unknown): ReconstructionAsset[] {
  const seen = new Set<string>()
  return collectAssetCandidates(raw)
    .map(normalizeAsset)
    .filter((asset): asset is ReconstructionAsset => Boolean(asset))
    .filter((asset) => {
      if (seen.has(asset.url)) return false
      seen.add(asset.url)
      return true
    })
}

function statusUrlFromTemplate(template: string, externalJobId: string): string {
  const encoded = encodeURIComponent(externalJobId)
  if (template.includes('{id}')) return template.replace('{id}', encoded)
  if (template.includes(':id')) return template.replace(':id', encoded)
  return `${template.replace(/\/$/, '')}/${encoded}`
}

async function readProviderJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

export async function submitLumaReconstructionJob(input: {
  images: ReconstructionInputImage[]
  callbackUrl?: string | null
}): Promise<{
  externalJobId: string
  status: ReconstructionJobStatus
  raw?: unknown
}> {
  const { apiKey, submitUrl } = getConfig()

  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      images: input.images,
      callbackUrl: input.callbackUrl ?? undefined,
    }),
  })

  const raw = await readProviderJson(response)
  if (!response.ok) {
    throw new Error(`Luma reconstruction submit failed with status ${response.status}.`)
  }

  const record = asRecord(raw)
  const externalJobId =
    asString(record?.id) ??
    asString(record?.jobId) ??
    asString(record?.job_id) ??
    asString(record?.externalJobId)

  if (!externalJobId) {
    throw new Error('Luma reconstruction response did not include a job id.')
  }

  return {
    externalJobId,
    status: normalizeLumaStatus(record?.status ?? record?.state),
    raw,
  }
}

export async function getLumaReconstructionStatus(input: {
  externalJobId: string
}): Promise<{
  status: ReconstructionJobStatus
  progress: number
  assets: ReconstructionAsset[]
  message?: string | null
  raw?: unknown
}> {
  const { apiKey, statusUrl } = getConfig()

  const response = await fetch(statusUrlFromTemplate(statusUrl, input.externalJobId), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  const raw = await readProviderJson(response)
  if (!response.ok) {
    throw new Error(`Luma reconstruction status failed with status ${response.status}.`)
  }

  const record = asRecord(raw)
  const progressRaw = record?.progress ?? record?.percent ?? record?.completion ?? record?.progressPercent
  const progressNumber = asNumber(progressRaw)
  const progress = Math.max(0, Math.min(100, progressNumber !== null && progressNumber <= 1 ? progressNumber * 100 : progressNumber ?? 0))

  return {
    status: normalizeLumaStatus(record?.status ?? record?.state),
    progress,
    assets: extractLumaAssets(raw),
    message: asString(record?.message) ?? asString(record?.error) ?? null,
    raw,
  }
}
