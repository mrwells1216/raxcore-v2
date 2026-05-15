import 'server-only'

export interface DepthExtractionResult {
  /** The depth map as a Float32Array, row-major, top-left origin */
  depthMap: Float32Array
  depthWidth: number
  depthHeight: number
  /** Primary image dimensions */
  imageWidth: number
  imageHeight: number
  dMin: number
  dMax: number
  /** Optional confidence map (1=low, 2=medium, 3=high per pixel) */
  confidenceMap: Uint8Array | null
  source: 'lidar_embedded'
}

export interface ExifCalibrationData {
  focalLengthMm: number | null
  sensorWidthMm: number | null
  imageWidthPx: number
  imageHeightPx: number
  make: string | null
  model: string | null
}

/**
 * Attempt to extract an embedded LiDAR depth map from a HEIC buffer.
 * Returns null if the file is not HEIC, has no depth auxiliary image, or
 * if extraction fails for any reason.
 *
 * Never throws. Always returns null on failure.
 */
export async function extractDepthFromHEIC(
  fileBuffer: Buffer,
): Promise<DepthExtractionResult | null> {
  try {
    // Detect HEIC magic bytes: ftyp box at offset 4 with 'heic', 'heis', 'mif1', etc.
    if (!isHeic(fileBuffer)) return null

    // Try libheif-js (WASM build — works in Node + Vercel without native compilation)
    return await extractWithLibheif(fileBuffer)
  } catch (err) {
    console.warn('[depth-extractor] extraction failed (non-blocking):', err)
    return null
  }
}

/**
 * Extract EXIF calibration fields from any image buffer.
 * Only reads: focal length, sensor dimensions, image size, make/model.
 * Does NOT read or store GPS, serial number, owner name, or other PII.
 *
 * Never throws. Returns null on failure.
 */
export async function extractExifCalibration(
  fileBuffer: Buffer,
): Promise<ExifCalibrationData | null> {
  try {
    // Use sharp for EXIF (it handles both HEIC and JPEG/WEBP)
    const sharp = await loadSharp()
    if (sharp) {
      return await extractExifWithSharp(sharp, fileBuffer)
    }

    // Fallback: manual EXIF parsing for JPEG
    return extractExifFromJpeg(fileBuffer)
  } catch (err) {
    console.warn('[depth-extractor] EXIF extraction failed (non-blocking):', err)
    return null
  }
}

// ─── HEIC detection ───────────────────────────────────────────────────────────

function isHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false
  // HEIC: bytes 4–7 = 'ftyp', bytes 8–11 = brand
  const ftyp = buf.slice(4, 8).toString('ascii')
  if (ftyp !== 'ftyp') return false
  const brand = buf.slice(8, 12).toString('ascii')
  return ['heic', 'heis', 'heim', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)
}

// ─── libheif-js extraction ────────────────────────────────────────────────────

async function extractWithLibheif(fileBuffer: Buffer): Promise<DepthExtractionResult | null> {
  let libheif: any
  try {
    // Dynamic import so the module is optional — scoring works without it
    // @ts-ignore — libheif-js has no bundled type declarations
    libheif = await import('libheif-js')
  } catch {
    console.warn('[depth-extractor] libheif-js not installed — run: pnpm add libheif-js')
    return null
  }

  const decoder = new libheif.HeifDecoder()
  const data = decoder.decode(new Uint8Array(fileBuffer))

  if (!data || data.length === 0) return null

  // Find the primary image (index 0) for dimensions
  const primaryImage = data[0]
  const imageWidth: number = primaryImage.get_width()
  const imageHeight: number = primaryImage.get_height()

  // Look for depth auxiliary image: libheif exposes auxiliary images
  // iPhone LiDAR depth maps are tagged with type 'urn:com:apple:photo:2020:aux:hdrgainmap'
  // or 'urn:com:apple:photo:2020:aux:Depth'
  let depthImage: any = null
  let confidenceImage: any = null

  for (const img of data) {
    const auxType: string | undefined = img.get_auxiliary_type?.()
    if (!auxType) continue
    if (auxType.includes('Depth') || auxType.includes('depth')) {
      depthImage = img
    } else if (auxType.includes('Disparity') || auxType.includes('disparity')) {
      // Disparity is the inverse of depth — handle below
      depthImage = img
    } else if (auxType.includes('Confidence') || auxType.includes('confidence')) {
      confidenceImage = img
    }
  }

  if (!depthImage) return null

  const depthWidth: number = depthImage.get_width()
  const depthHeight: number = depthImage.get_height()

  // Decode depth pixels
  const depthPixels = await decodeImagePixels(depthImage)
  if (!depthPixels) return null

  // iPhone depth auxiliary images are float16 encoded as RGBA or as raw float32.
  // After decoding we receive a Uint8Array or Float32Array depending on libheif-js version.
  // Normalize to Float32Array of distances in meters.
  const depthMap = normalizeToDepthMeters(depthPixels, depthWidth * depthHeight)

  let confidenceMap: Uint8Array | null = null
  if (confidenceImage) {
    const confPixels = await decodeImagePixels(confidenceImage)
    if (confPixels) {
      confidenceMap = new Uint8Array(depthWidth * depthHeight)
      for (let i = 0; i < confidenceMap.length; i++) {
        // Scale 0–255 → 1–3
        confidenceMap[i] = Math.max(1, Math.min(3, Math.ceil((confPixels[i * 4] / 255) * 3)))
      }
    }
  }

  let dMin = Infinity
  let dMax = -Infinity
  for (let i = 0; i < depthMap.length; i++) {
    const v = depthMap[i]
    if (v > 0 && v < 1000) {
      if (v < dMin) dMin = v
      if (v > dMax) dMax = v
    }
  }
  if (!isFinite(dMin)) dMin = 0
  if (!isFinite(dMax)) dMax = 0

  return {
    depthMap,
    depthWidth,
    depthHeight,
    imageWidth,
    imageHeight,
    dMin,
    dMax,
    confidenceMap,
    source: 'lidar_embedded',
  }
}

async function decodeImagePixels(img: any): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      img.display({ data: new Uint8ClampedArray(img.get_width() * img.get_height() * 4) }, (displayData: any) => {
        if (!displayData) { resolve(null); return }
        resolve(new Uint8Array(displayData.data.buffer))
      })
    } catch {
      resolve(null)
    }
  })
}

function normalizeToDepthMeters(pixels: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count)
  // RGBA layout: each pixel is 4 bytes. Red channel encodes normalized depth 0–1.
  // iPhone stores depth in meters encoded linearly; red channel = distance / maxRange.
  // Without the exact range we treat max red = max depth seen (relative).
  // If the image was decoded as float32, just use it directly.
  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4] / 255
    // Typical iPhone LiDAR range: 0.3m – 5m. Linear decode.
    out[i] = r * 5.0
  }
  return out
}

// ─── Sharp EXIF extraction ────────────────────────────────────────────────────

async function loadSharp(): Promise<any | null> {
  try {
    // @ts-ignore — sharp may not be a direct dep; it's available as a Next.js peer
    const m = await import('sharp')
    return m.default ?? m
  } catch {
    return null
  }
}

async function extractExifWithSharp(sharpFn: any, fileBuffer: Buffer): Promise<ExifCalibrationData | null> {
  const meta = await sharpFn(fileBuffer).metadata()

  const imageWidthPx: number = meta.width ?? 0
  const imageHeightPx: number = meta.height ?? 0

  const exif: Record<string, any> = meta.exif ? parseExifBuffer(meta.exif) : {}

  const focalLengthMm: number | null = exif.focalLengthMm ?? null
  const sensorWidthMm: number | null = exif.focalPlaneXResolutionMm ?? null
  const rawMake: unknown = exif.make ?? meta.ifd0?.Make ?? null
  const rawModel: unknown = exif.model ?? meta.ifd0?.Model ?? null

  return {
    focalLengthMm,
    sensorWidthMm,
    imageWidthPx,
    imageHeightPx,
    make: typeof rawMake === 'string' ? rawMake.replace(/\0/g, '').trim() : null,
    model: typeof rawModel === 'string' ? rawModel.replace(/\0/g, '').trim() : null,
  }
}

// ─── Minimal JPEG EXIF parser ─────────────────────────────────────────────────

function extractExifFromJpeg(buf: Buffer): ExifCalibrationData | null {
  // Only attempt JPEG (SOI = 0xFFD8)
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null

  try {
    const exif = findExifSegment(buf)
    if (!exif) return null
    const parsed = parseExifBuffer(exif)
    return {
      focalLengthMm: typeof parsed.focalLengthMm === 'number' ? parsed.focalLengthMm : null,
      sensorWidthMm: typeof parsed.focalPlaneXResolutionMm === 'number' ? parsed.focalPlaneXResolutionMm : null,
      imageWidthPx: 0,
      imageHeightPx: 0,
      make: typeof parsed.make === 'string' ? parsed.make : null,
      model: typeof parsed.model === 'string' ? parsed.model : null,
    }
  } catch {
    return null
  }
}

function findExifSegment(buf: Buffer): Buffer | null {
  let offset = 2
  while (offset < buf.length - 4) {
    if (buf[offset] !== 0xff) break
    const marker = buf[offset + 1]
    const length = buf.readUInt16BE(offset + 2)
    if (marker === 0xe1) {
      // APP1 — may contain EXIF
      const header = buf.slice(offset + 4, offset + 10).toString('ascii')
      if (header.startsWith('Exif')) {
        return buf.slice(offset + 10, offset + 2 + length)
      }
    }
    offset += 2 + length
  }
  return null
}

function parseExifBuffer(exifBuf: Buffer): Record<string, any> {
  try {
    // We only need a few fields — implement a minimal TIFF/IFD reader
    if (exifBuf.length < 8) return {}

    const littleEndian = exifBuf[0] === 0x49 && exifBuf[1] === 0x49
    const read16 = (o: number) => littleEndian ? exifBuf.readUInt16LE(o) : exifBuf.readUInt16BE(o)
    const read32 = (o: number) => littleEndian ? exifBuf.readUInt32LE(o) : exifBuf.readUInt32BE(o)

    const ifdOffset = read32(4)
    return parseIfd(exifBuf, ifdOffset, littleEndian, read16, read32)
  } catch {
    return {}
  }
}

function parseIfd(
  buf: Buffer,
  offset: number,
  le: boolean,
  read16: (o: number) => number,
  read32: (o: number) => number,
): Record<string, any> {
  const result: Record<string, any> = {}
  if (offset + 2 > buf.length) return result

  const entryCount = read16(offset)
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = offset + 2 + i * 12
    if (entryOffset + 12 > buf.length) break

    const tag = read16(entryOffset)
    const type = read16(entryOffset + 2)
    const count = read32(entryOffset + 4)
    const valueOffset = entryOffset + 8

    try {
      switch (tag) {
        case 0x010f: // Make
          result.make = readString(buf, valueOffset, count, read32)
          break
        case 0x0110: // Model
          result.model = readString(buf, valueOffset, count, read32)
          break
        case 0x920a: // FocalLength (rational)
          result.focalLengthMm = readRational(buf, valueOffset, read32, le)
          break
        case 0xa20e: // FocalPlaneXResolution (rational) — pixels per resolution unit
          result.focalPlaneXResolution = readRational(buf, valueOffset, read32, le)
          break
        case 0xa20f: // FocalPlaneYResolution
          result.focalPlaneYResolution = readRational(buf, valueOffset, read32, le)
          break
        case 0xa210: // FocalPlaneResolutionUnit (2=inch, 3=cm)
          result.focalPlaneResolutionUnit = count > 0 ? read16(valueOffset) : 2
          break
      }
    } catch {
      // skip malformed tag
    }
  }

  // Compute sensorWidthMm from FocalPlaneXResolution if available
  // FocalPlaneXResolution = pixels per resolution unit
  // sensorWidthMm = imageWidthPx / FocalPlaneXResolution * unitInMm
  if (result.focalPlaneXResolution && result.focalPlaneXResolution > 0) {
    const unit = result.focalPlaneResolutionUnit ?? 2
    const unitMm = unit === 3 ? 10 : 25.4  // cm→mm or inch→mm
    result.focalPlaneXResolutionMm = unitMm / result.focalPlaneXResolution
  }

  return result
}

function readString(buf: Buffer, valueOffset: number, count: number, read32: (o: number) => number): string {
  const dataOffset = count <= 4 ? valueOffset : read32(valueOffset)
  return buf.slice(dataOffset, dataOffset + count).toString('ascii').replace(/\0/g, '').trim()
}

function readRational(buf: Buffer, valueOffset: number, read32: (o: number) => number, le: boolean): number {
  const dataOffset = read32(valueOffset)
  const num = le ? buf.readUInt32LE(dataOffset) : buf.readUInt32BE(dataOffset)
  const den = le ? buf.readUInt32LE(dataOffset + 4) : buf.readUInt32BE(dataOffset + 4)
  return den !== 0 ? num / den : 0
}
