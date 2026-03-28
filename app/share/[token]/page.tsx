import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Target, 
  Camera, 
  MapPin, 
  Calendar,
  ExternalLink,
  Crosshair
} from 'lucide-react'
import { getBuckByShareToken } from '@/lib/storage/service'
import { notFound } from 'next/navigation'

interface SharePageProps {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: SharePageProps) {
  const { token } = await params
  const buck = await getBuckByShareToken(token)
  
  if (!buck) {
    return { title: 'Shared Buck | RAXcore' }
  }

  const prediction = buck.predictions?.[0]
  const score = prediction?.predicted_gross?.toFixed(1) || 'N/A'
  
  return {
    title: `${score}" Buck - Shared from RAXcore`,
    description: `AI-scored whitetail buck - ${score}" gross score. View the detailed scoring breakdown.`,
    openGraph: {
      title: `${score}" Buck - RAXcore AI Score`,
      description: `Check out this AI-scored whitetail buck: ${score}" gross score`,
      images: buck.buck_images?.[0]?.public_url ? [buck.buck_images[0].public_url] : [],
    },
  }
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params
  const buck = await getBuckByShareToken(token)
  
  if (!buck) {
    notFound()
  }

  const prediction = buck.predictions?.[0]
  const primaryImage = buck.buck_images?.find((img) => img.public_url)?.public_url

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-14 max-w-screen-xl items-center px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              Rx
            </div>
            <span className="font-semibold text-lg tracking-tight">RAXcore</span>
          </Link>
          <div className="flex-1" />
          <Button asChild size="sm">
            <Link href="/score">
              Score Your Buck
            </Link>
          </Button>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-8 pb-24">
        {/* Shared badge */}
        <div className="flex justify-center mb-6">
          <Badge variant="secondary" className="gap-2">
            <ExternalLink className="h-3 w-3" />
            Shared from RAXcore
          </Badge>
        </div>

        {/* Main image */}
        <Card className="overflow-hidden mb-6">
          <div className="relative aspect-[4/3] bg-muted">
            {primaryImage ? (
              <Image 
                src={primaryImage} 
                alt="Scored buck" 
                fill 
                className="object-cover" 
                priority
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Camera className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
        </Card>

        {/* Score card */}
        {prediction && (
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                AI Score Estimate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-3xl font-bold text-primary">
                    {prediction.predicted_gross?.toFixed(1)}&quot;
                  </div>
                  <div className="text-sm text-muted-foreground">Gross Score</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-3xl font-bold">
                    {prediction.predicted_net?.toFixed(1)}&quot;
                  </div>
                  <div className="text-sm text-muted-foreground">Net Score</div>
                </div>
              </div>
              
              {/* Confidence */}
              {prediction.confidence_percent && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Crosshair className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {prediction.confidence_percent.toFixed(0)}% confidence
                  </span>
                </div>
              )}

              {/* Score range */}
              {prediction.score_range_low && prediction.score_range_high && (
                <div className="mt-2 text-center text-sm text-muted-foreground">
                  Likely range: {prediction.score_range_low.toFixed(1)}&quot; - {prediction.score_range_high.toFixed(1)}&quot;
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Details */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {buck.state && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{buck.state}</span>
              </div>
            )}
            {buck.rack_type && (
              <div className="flex items-center gap-3 text-sm">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="capitalize">{buck.rack_type} rack</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Scored on {new Date(buck.created_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}</span>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="text-center text-xs text-muted-foreground mb-8">
          <p>
            This is an AI-generated score estimate and should not be used as an official measurement.
            For official scoring, please consult a certified Boone &amp; Crockett measurer.
          </p>
        </div>

        {/* CTA */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <h3 className="text-lg font-semibold mb-2">Want to score your own buck?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get an AI-powered score estimate in seconds
            </p>
            <Button asChild size="lg">
              <Link href="/score">
                <Target className="mr-2 h-4 w-4" />
                Start Scoring
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
