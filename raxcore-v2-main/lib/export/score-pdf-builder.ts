import type { VerifiedPdfExportData, VerifiedPdfMeasurementRow } from './score-pdf-types'

const DISCLAIMER =
  'RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules.'

function fmt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value.toFixed(2) : '--'
}

function pct(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

export async function buildVerifiedScorePdf(data: VerifiedPdfExportData): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 42
  const contentWidth = pageWidth - margin * 2

  const writeWrapped = (text: string, x: number, y: number, width = contentWidth, lineHeight = 13): number => {
    const lines = pdf.splitTextToSize(text, width)
    pdf.text(lines, x, y)
    return y + lines.length * lineHeight
  }

  const title = (heading: string, subtitle?: string) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text('RAX CORE', margin, 46)
    pdf.setFontSize(13)
    pdf.text(heading, margin, 70)
    if (subtitle) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(subtitle, margin, 86)
    }
  }

  title('Advanced Score Evidence Report', data.verified ? 'Verified Score - internally cross-validated' : 'Unverified Advanced Score')
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  let y = 122
  const summaryRows = [
    ['Buck', data.buckName || 'Unnamed buck'],
    ['Scoring System', data.scoringSystem === 'boone_crockett' ? 'Boone & Crockett' : 'Pope & Young'],
    ['Rack Type', data.rackType === 'typical' ? 'Typical' : 'Non-typical'],
    ['Gross Score', fmt(data.grossScore)],
    ['Net Score', fmt(data.netScore)],
    ['Verification', data.verified ? 'Verified Score' : 'Unverified Advanced Score'],
    ['Overall Confidence', pct(data.confidenceSummary.overallConfidence)],
    ['Created', new Date(data.createdAt).toLocaleString()],
  ]
  for (const [label, value] of summaryRows) {
    pdf.setFont('helvetica', 'bold')
    pdf.text(label, margin, y)
    pdf.setFont('helvetica', 'normal')
    pdf.text(value, margin + 150, y)
    y += 22
  }
  y += 16
  pdf.setFont('helvetica', data.verified ? 'bold' : 'normal')
  pdf.setTextColor(data.verified ? 30 : 160, data.verified ? 130 : 90, data.verified ? 70 : 30)
  y = writeWrapped(
    data.verified
      ? 'Verified Score means RAX CORE found the required internal evidence, calibration, and cross-method agreement.'
      : 'This score is not verified. Missing, estimated, inferred, or disagreeing evidence is documented in the following pages.',
    margin,
    y,
  )
  pdf.setTextColor(0, 0, 0)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  writeWrapped(DISCLAIMER, margin, y + 20)

  pdf.addPage()
  title('Measurement Table')
  y = 112
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Field', margin, y)
  pdf.text('Final', 170, y, { align: 'right' })
  pdf.text('Photo', 230, y, { align: 'right' })
  pdf.text('Point Cloud', 315, y, { align: 'right' })
  pdf.text('Mesh', 370, y, { align: 'right' })
  pdf.text('Conf.', 420, y, { align: 'right' })
  pdf.text('Warning', 438, y)
  y += 14
  pdf.setFont('helvetica', 'normal')

  const writeMeasurement = (row: VerifiedPdfMeasurementRow) => {
    if (y > 728) {
      pdf.addPage()
      title('Measurement Table Continued')
      y = 112
      pdf.setFontSize(8)
    }
    pdf.text(row.label.slice(0, 24), margin, y)
    pdf.text(fmt(row.finalValue), 170, y, { align: 'right' })
    pdf.text(fmt(row.photoValue), 230, y, { align: 'right' })
    pdf.text(fmt(row.pointCloudValue), 315, y, { align: 'right' })
    pdf.text(fmt(row.meshFallbackValue), 370, y, { align: 'right' })
    pdf.text(pct(row.confidence), 420, y, { align: 'right' })
    pdf.text((row.warning ?? '').slice(0, 38), 438, y)
    y += 16
  }
  data.measurements.forEach(writeMeasurement)

  pdf.addPage()
  title('Verification Summary')
  y = 112
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  pdf.text(data.verified ? 'Verified: true' : 'Verified: false', margin, y)
  y += 24
  pdf.setFont('helvetica', 'normal')
  for (const reason of data.verificationReasons.slice(0, 18)) {
    y = writeWrapped(`- ${reason}`, margin, y, contentWidth)
  }
  y += 16
  const photoCalibrationText = data.calibrationSummary.photoCalibrations.length > 0
    ? data.calibrationSummary.photoCalibrations
        .map((calibration) => `${calibration.photoId}: ${calibration.pixelsPerInch.toFixed(3)} px/in, ${calibration.referenceLengthInches}" ${calibration.source}`)
        .join('; ')
    : 'No photo calibration recorded.'
  y = writeWrapped(`Photo calibration: ${photoCalibrationText}`, margin, y)
  const calibration3D = data.calibrationSummary.calibration3D
  y = writeWrapped(
    `3D calibration: ${calibration3D ? `${calibration3D.unitsPerInch.toFixed(5)} units/in, ${calibration3D.referenceLengthInches}" ${calibration3D.source}` : 'No 3D calibration recorded.'}`,
    margin,
    y + 8,
  )
  const recon = data.reconstructionSummary
  y = writeWrapped(
    `Reconstruction: provider=${recon.provider ?? 'none'}, mesh=${recon.hasMesh ? 'present' : 'missing'}, point cloud=${recon.hasPointCloud ? 'present' : 'missing'}, splat=${recon.hasSplat ? 'present' : 'missing'}, point count=${recon.pointCloudPointCount ?? 'unknown'}.`,
    margin,
    y + 8,
  )
  writeWrapped(
    `Cross-validation: high=${data.confidenceSummary.highCount}, medium=${data.confidenceSummary.mediumCount}, low=${data.confidenceSummary.lowCount}. High requires independent agreement within 3%; mesh fallback alone cannot verify.`,
    margin,
    y + 8,
  )

  pdf.addPage()
  title('Evidence / Notes')
  y = 112
  pdf.setFontSize(10)
  if (data.photoThumbnails?.length) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Photo thumbnails', margin, y)
    y += 16
    for (const thumbnail of data.photoThumbnails.slice(0, 6)) {
      try {
        pdf.addImage(thumbnail, thumbnail.startsWith('data:image/png') ? 'PNG' : 'JPEG', margin, y, 70, 52)
        y += 60
      } catch {
        y = writeWrapped('- Thumbnail could not be embedded.', margin, y)
      }
    }
  } else {
    y = writeWrapped('No photo thumbnails were embedded in this export.', margin, y)
  }
  y += 16
  y = writeWrapped('Method notes: point-cloud anchored measurements are preferred when available. Mesh fallback measurements are explicitly lower-confidence and inferred. Gaussian splats are visual evidence only in this build.', margin, y)
  writeWrapped(DISCLAIMER, margin, y + 18)

  return pdf.output('blob')
}
