import Link from 'next/link'
import { Camera, Upload, Target, TrendingUp, Shield, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AppHeader } from '@/components/app-header'
import { BinaryCamoBackground } from '@/components/binary-camo-background'

const features = [
  {
    icon: Target,
    title: 'B&C Style Scoring',
    description: 'Estimates based on official Boone & Crockett measurement methodology',
  },
  {
    icon: Zap,
    title: 'Instant Analysis',
    description: 'Get results in seconds using anatomical scaling references',
  },
  {
    icon: TrendingUp,
    title: 'Confidence Bands',
    description: 'Transparent error estimates based on image quality and angles',
  },
  {
    icon: Shield,
    title: 'Training Engine',
    description: 'Submit real scores to help improve accuracy over time',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-svh flex flex-col bg-background">
      <AppHeader />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden min-h-[600px] md:min-h-[650px]">
          <BinaryCamoBackground showToggle={true} />
          
          <div className="container relative z-10 max-w-screen-xl mx-auto px-4 py-16 md:py-24">
            <div className="flex flex-col items-center text-center gap-6 max-w-2xl mx-auto">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/30 bg-background/40 backdrop-blur-sm text-sm text-[#dfe7d9]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                AI-Powered Antler Scoring
              </div>
              
              {/* Heading */}
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-balance text-[#dfe7d9]" style={{ textShadow: '0 0 8px rgba(40, 60, 40, 0.5)' }}>
                Score Your Buck
                <span className="block text-primary">With AI Precision</span>
              </h1>
              
              {/* Description */}
              <p className="text-lg text-[#dfe7d9]/85 text-pretty max-w-xl">
                Get estimated Boone & Crockett style scores from your photos. 
                Using anatomical scaling references like ear length and eye spacing 
                for accurate measurements.
              </p>
              
              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto min-h-[52px] gap-2 bg-primary hover:bg-primary/90" asChild>
                  <Link href="/score">
                    <Camera className="h-5 w-5" />
                    Start Scoring
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="w-full sm:w-auto min-h-[52px] gap-2 bg-background/30 border-[#dfe7d9]/30 text-[#dfe7d9] hover:bg-background/50 hover:text-[#dfe7d9]" asChild>
                  <Link href="/score?mode=upload">
                    <Upload className="h-5 w-5" />
                    Upload Photos
                  </Link>
                </Button>
              </div>
              
              {/* Disclaimer */}
              <p className="text-xs text-[#dfe7d9]/60 max-w-md">
                AI estimates only. Official scoring requires physical measurement 
                by a certified scorer.
              </p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-t border-border bg-secondary/30">
          <div className="container max-w-screen-xl mx-auto px-4 py-16">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-3">
                How It Works
              </h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                Our AI analyzes visible anatomical landmarks to estimate antler measurements
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {features.map((feature) => (
                <Card key={feature.title} className="bg-card/50 border-border/50">
                  <CardContent className="p-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Scoring Steps */}
        <section className="border-t border-border">
          <div className="container max-w-screen-xl mx-auto px-4 py-16">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-3">
                Best Results in 3 Steps
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                  1
                </div>
                <h3 className="font-semibold">Capture Multiple Angles</h3>
                <p className="text-sm text-muted-foreground">
                  Front, left, and right side photos provide the highest accuracy
                </p>
              </div>
              
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                  2
                </div>
                <h3 className="font-semibold">Include Ears & Eyes</h3>
                <p className="text-sm text-muted-foreground">
                  Visible ears and eyes enable precise anatomical scaling
                </p>
              </div>
              
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                  3
                </div>
                <h3 className="font-semibold">Get Your Estimate</h3>
                <p className="text-sm text-muted-foreground">
                  Receive gross/net scores with confidence bands and measurement breakdown
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border bg-primary/5">
          <div className="container max-w-screen-xl mx-auto px-4 py-16">
            <div className="flex flex-col items-center text-center gap-6 max-w-xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold">
                Ready to Score Your Buck?
              </h2>
              <p className="text-muted-foreground">
                No account required. Start with a single photo or capture multiple angles for best results.
              </p>
              <Button size="lg" className="min-h-[52px] gap-2" asChild>
                <Link href="/score">
                  <Target className="h-5 w-5" />
                  Get Started Free
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="container max-w-screen-xl mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-xs">Rx</div>
              <span className="text-sm text-muted-foreground">
                RAXcore
              </span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              AI estimates only. Not affiliated with B&C or P&Y.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
