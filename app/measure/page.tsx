import { Metadata } from 'next'
import { MeasureClient } from './measure-client'

export const metadata: Metadata = {
  title: 'Measure | RAXcore Antler Analytics',
  description: 'Photo-based polyline measurement tool with calibration, SAM segmentation assist, and 3D GLB measurement — Boone & Crockett scoring in real time.',
}

export default function MeasurePage() {
  return <MeasureClient />
}
