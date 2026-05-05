import Link from 'next/link'
import { Camera, Upload, Target, TrendingUp, Shield, Zap } from 'lucide-react'
import { AppHeader } from '@/components/app-header'

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

const steps = [
  {
    n: '01',
    title: 'Capture Multiple Angles',
    body: 'Front, left, and right side photos provide the highest accuracy',
  },
  {
    n: '02',
    title: 'Include Ears & Eyes',
    body: 'Visible ears and eyes enable precise anatomical scaling',
  },
  {
    n: '03',
    title: 'Get Your Estimate',
    body: 'Receive gross/net scores with confidence bands and measurement breakdown',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-svh flex flex-col" style={{ background: 'var(--background)' }}>
      <AppHeader />

      <main className="flex-1 pb-20 md:pb-0">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden min-h-[560px] flex items-center">
          {/* Leather texture overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 120% 80% at 50% 110%, oklch(0.20 0.015 40) 0%, transparent 65%),
                repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 2px,
                  rgba(255,210,100,0.015) 2px,
                  rgba(255,210,100,0.015) 3px
                ),
                repeating-linear-gradient(
                  90deg,
                  transparent,
                  transparent 2px,
                  rgba(255,210,100,0.015) 2px,
                  rgba(255,210,100,0.015) 3px
                ),
                oklch(0.13 0.010 40)
              `,
            }}
          />

          {/* Bronze corner brackets */}
          {['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'].map((pos, i) => (
            <div
              key={i}
              className={`absolute ${pos} h-6 w-6 pointer-events-none`}
              style={{
                borderColor: 'var(--bronze-dark)',
                borderStyle: 'solid',
                borderWidth: i === 0 ? '2px 0 0 2px' : i === 1 ? '2px 2px 0 0' : i === 2 ? '0 0 2px 2px' : '0 2px 2px 0',
              }}
            />
          ))}

          <div className="relative z-10 max-w-screen-xl mx-auto px-6 py-20 w-full">
            <div className="flex flex-col items-center text-center gap-8 max-w-xl mx-auto">

              {/* Live badge */}
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono tracking-widest uppercase"
                style={{
                  border: '1px solid var(--bronze-dark)',
                  background: 'rgba(160,120,42,0.10)',
                  color: 'var(--bronze-light)',
                }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ background: 'var(--scan-green)' }}
                  />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: 'var(--scan-green)' }} />
                </span>
                AI-Powered Antler Scoring
              </div>

              {/* Heading — logo plate replaces text wordmark */}
              <div>
                <img
                  src="/raxcore-logo.jpg"
                  alt="RAXcore Antler Analytics"
                  style={{
                    display: 'block',
                    height: 'auto',
                    width: '100%',
                    maxWidth: 360,
                    borderRadius: 6,
                    outline: '2px solid rgba(255,255,255,0.85)',
                    outlineOffset: '0px',
                  }}
                />
              </div>

              <p className="text-sm leading-relaxed max-w-md" style={{ color: 'oklch(0.78 0.010 55)' }}>
                Get estimated Boone &amp; Crockett style scores from your photos using anatomical
                scaling references like ear length and eye spacing for accurate measurements.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Link
                  href="/score"
                  className="flex items-center justify-center gap-2 min-h-[52px] px-8 rounded text-sm font-bold tracking-widest uppercase touch-manipulation transition-all active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
                    color: 'oklch(0.13 0.010 40)',
                    boxShadow: '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 4px 16px rgba(0,0,0,0.55)',
                  }}
                >
                  <Camera className="h-4 w-4" />
                  Start Scoring
                </Link>
                <Link
                  href="/score?mode=upload"
                  className="flex items-center justify-center gap-2 min-h-[52px] px-8 rounded text-sm font-bold tracking-widest uppercase touch-manipulation transition-all"
                  style={{
                    border: '1px solid var(--bronze-dark)',
                    background: 'oklch(0.18 0.012 40)',
                    color: 'var(--bronze-light)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.40)',
                  }}
                >
                  <Upload className="h-4 w-4" />
                  Upload Photos
                </Link>
              </div>

              <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                AI estimates only. Official scoring requires physical measurement by a certified scorer.
              </p>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────── */}
        <section
          className="border-t"
          style={{ borderColor: 'var(--bronze-dark)' }}
        >
          <div className="max-w-screen-xl mx-auto px-6 py-16">
            <div className="text-center mb-10">
              <h2
                className="text-[11px] font-bold tracking-[0.28em] uppercase mb-3"
                style={{ color: 'var(--bronze-light)' }}
              >
                Capabilities
              </h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Our AI analyzes visible anatomical landmarks to estimate antler measurements
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-lg p-5 space-y-3"
                  style={{
                    border: '1px solid var(--bronze-dark)',
                    background: 'linear-gradient(180deg, oklch(0.19 0.012 40) 0%, oklch(0.16 0.010 40) 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.40), 0 1px 0 rgba(255,210,100,0.07)',
                  }}
                >
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded"
                    style={{
                      background: 'linear-gradient(160deg, var(--bronze-light) 0%, var(--bronze-dark) 100%)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                    }}
                  >
                    <f.icon className="h-4 w-4" style={{ color: 'oklch(0.13 0.010 40)' }} />
                  </div>
                  <div>
                    <h3
                      className="text-xs font-bold tracking-wider uppercase mb-1"
                      style={{ color: 'var(--bronze-light)' }}
                    >
                      {f.title}
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{f.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Steps ────────────────────────────────────────────────────── */}
        <section
          className="border-t"
          style={{ borderColor: 'var(--bronze-dark)' }}
        >
          <div className="max-w-screen-xl mx-auto px-6 py-16">
            <div className="text-center mb-10">
              <h2
                className="text-[11px] font-bold tracking-[0.28em] uppercase"
                style={{ color: 'var(--bronze-light)' }}
              >
                Protocol
              </h2>
              <p className="text-sm text-muted-foreground mt-2">Best results in 3 steps</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              {steps.map((s) => (
                <div
                  key={s.n}
                  className="rounded-lg p-5 flex flex-col gap-3"
                  style={{
                    border: '1px solid var(--bronze-dark)',
                    background: 'oklch(0.16 0.010 40)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.40)',
                  }}
                >
                  <span
                    className="text-3xl font-bold font-mono"
                    style={{
                      background: 'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-dark) 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-xs font-bold tracking-wider uppercase mb-1" style={{ color: 'var(--bronze-light)' }}>
                      {s.title}
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA bottom ───────────────────────────────────────────────── */}
        <section
          className="border-t"
          style={{ borderColor: 'var(--bronze-dark)', background: 'rgba(160,120,42,0.05)' }}
        >
          <div className="max-w-screen-xl mx-auto px-6 py-16 flex flex-col items-center text-center gap-6">
            <h2
              className="text-[11px] font-bold tracking-[0.28em] uppercase"
              style={{ color: 'var(--bronze-light)' }}
            >
              Ready to Score?
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              No account required. Start with a single photo or capture multiple angles for best results.
            </p>
            <Link
              href="/score"
              className="flex items-center gap-2 min-h-[52px] px-10 rounded text-sm font-bold tracking-widest uppercase touch-manipulation transition-all active:scale-[0.98]"
              style={{
                background: 'linear-gradient(180deg, var(--bronze-light) 0%, var(--bronze-mid) 55%, var(--bronze-dark) 100%)',
                color: 'oklch(0.13 0.010 40)',
                boxShadow: '0 1px 0 rgba(255,230,150,0.22) inset, 0 -1px 0 rgba(0,0,0,0.35) inset, 0 4px 16px rgba(0,0,0,0.55)',
              }}
            >
              <Target className="h-4 w-4" />
              Get Started Free
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        className="border-t py-5"
        style={{ borderColor: 'var(--bronze-dark)' }}
      >
        <div className="max-w-screen-xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded"
              style={{
                background: 'linear-gradient(160deg, var(--bronze-light) 0%, var(--bronze-dark) 100%)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
              }}
            >
              <span className="text-[10px] font-black" style={{ color: 'oklch(0.13 0.010 40)' }}>Rx</span>
            </div>
            <span
              className="text-xs font-bold tracking-[0.20em] uppercase"
              style={{ color: 'var(--bronze-mid)' }}
            >
              RAXCORE
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground text-center">
            AI estimates only. Not affiliated with B&amp;C or P&amp;Y.
          </p>
        </div>
      </footer>
    </div>
  )
}
