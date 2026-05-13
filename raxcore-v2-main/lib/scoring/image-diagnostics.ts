export type ImageDiagnostics = {
  index: number
  blurScore: number
  brightnessScore: number
  contrastScore: number
  edgeDensity: number
  likelyBlurry: boolean
  tooDark: boolean
  tooBright: boolean
  lowDetail: boolean
  overallQuality: 'good' | 'ok' | 'poor'
}

export type ImageDiagnosticsSummary = {
  overall: 'strong' | 'mixed' | 'weak'
  poorCount: number
  okCount: number
  total: number
}

export function computeImageDiagnosticsFromFile(file: File, index: number): Promise<ImageDiagnostics> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const url = URL.createObjectURL(file)

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(defaultDiagnostics(index))
          URL.revokeObjectURL(url)
          return
        }

        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data

        let totalBrightness = 0
        let totalContrast = 0
        let edgeCount = 0
        const sampleRate = 4

        // Sample every Nth pixel to avoid processing huge images
        for (let i = 0; i < data.length; i += sampleRate * 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]

          const brightness = (r + g + b) / 3
          totalBrightness += brightness

          // Compare with next pixel for contrast
          if (i + 4 < data.length) {
            const r2 = data[i + 4]
            const g2 = data[i + 5]
            const b2 = data[i + 6]
            const brightness2 = (r2 + g2 + b2) / 3

            const diff = Math.abs(brightness - brightness2)
            totalContrast += diff

            if (diff > 30) {
              edgeCount++
            }
          }
        }

        const sampleCount = data.length / (sampleRate * 4)
        const avgBrightness = totalBrightness / sampleCount
        const contrastScore = totalContrast / sampleCount
        const edgeDensity = edgeCount / sampleCount

        const likelyBlurry = edgeDensity < 0.05
        const tooDark = avgBrightness < 60
        const tooBright = avgBrightness > 200
        const lowDetail = contrastScore < 10

        let overallQuality: ImageDiagnostics['overallQuality'] = 'good'

        if (likelyBlurry || tooDark || tooBright) {
          overallQuality = 'poor'
        } else if (lowDetail) {
          overallQuality = 'ok'
        }

        resolve({
          index,
          blurScore: edgeDensity,
          brightnessScore: avgBrightness,
          contrastScore,
          edgeDensity,
          likelyBlurry,
          tooDark,
          tooBright,
          lowDetail,
          overallQuality,
        })
      } catch (err) {
        resolve(defaultDiagnostics(index))
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    img.onerror = () => {
      resolve(defaultDiagnostics(index))
      URL.revokeObjectURL(url)
    }

    img.src = url
  })
}

export function summarizeDiagnostics(diags: ImageDiagnostics[]): ImageDiagnosticsSummary | null {
  if (!diags.length) return null

  const poor = diags.filter(d => d.overallQuality === 'poor').length
  const ok = diags.filter(d => d.overallQuality === 'ok').length

  let overall: 'strong' | 'mixed' | 'weak' = 'strong'

  if (poor > 0) overall = 'weak'
  else if (ok > 0) overall = 'mixed'

  return {
    overall,
    poorCount: poor,
    okCount: ok,
    total: diags.length,
  }
}

function defaultDiagnostics(index: number): ImageDiagnostics {
  return {
    index,
    blurScore: 0,
    brightnessScore: 0,
    contrastScore: 0,
    edgeDensity: 0,
    likelyBlurry: false,
    tooDark: false,
    tooBright: false,
    lowDetail: false,
    overallQuality: 'ok',
  }
}
