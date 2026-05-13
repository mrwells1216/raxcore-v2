import { Metadata } from 'next'
import { AppHeader } from '@/components/app-header'
import { MeasureClient } from './measure-client'

export const metadata: Metadata = {
  title: 'Measure | RAXcore Antler Analytics',
  description: 'Photo-based polyline measurement tool with calibration, SAM segmentation assist, and 3D GLB measurement — Boone & Crockett scoring in real time.',
}

export default function MeasurePage() {
  return (
    <div className="flex flex-col bg-background" style={{ minHeight: '100dvh' }}>
      <AppHeader />
      <MeasureClient />
    </div>
  )
}
