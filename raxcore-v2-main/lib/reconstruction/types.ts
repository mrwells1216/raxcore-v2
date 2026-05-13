export type ReconstructionProvider = 'luma' | 'manual'

export type ReconstructionJobStatus =
  | 'idle'
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'requires_manual_upload'

export type ReconstructionAssetType =
  | 'mesh_glb'
  | 'point_cloud_xyz'
  | 'point_cloud_ply'
  | 'point_cloud_csv'
  | 'gaussian_splat'
  | 'preview_image'
  | 'unknown'

export interface ReconstructionInputImage {
  id: string
  fileName: string
  url?: string
  dataUrl?: string
  angleHint?: string | null
  width?: number | null
  height?: number | null
}

export interface ReconstructionAsset {
  id: string
  type: ReconstructionAssetType
  url: string
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  provider?: ReconstructionProvider
  metadata?: Record<string, unknown>
}

export interface ReconstructionJob {
  id: string
  provider: ReconstructionProvider
  externalJobId?: string | null
  status: ReconstructionJobStatus
  progress: number
  message?: string | null
  inputImages: ReconstructionInputImage[]
  assets: ReconstructionAsset[]
  error?: string | null
  createdAt: string
  updatedAt: string
}

export function isActiveReconstructionStatus(status: ReconstructionJobStatus): boolean {
  return status === 'queued' || status === 'uploading' || status === 'processing'
}
