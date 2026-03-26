import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertTriangle, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react'
import { getErrorPatterns, getErrorCorrections, type CategoryError } from '@/lib/scoring/error-tracking'

export const dynamic = 'force-dynamic'

export default async function ErrorPatternsPage() {
  const patterns = await getErrorPatterns(200)
  const corrections = getErrorCorrections(patterns)

  const getBiasIcon = (bias: 'over' | 'under' | 'neutral') => {
    if (bias === 'over') return <TrendingUp className="h-4 w-4 text-orange-500" />
    if (bias === 'under') return <TrendingDown className="h-4 w-4 text-blue-500" />
    return <Minus className="h-4 w-4 text-muted-foreground" />
  }

  const getBiasBadge = (bias: 'over' | 'under' | 'neutral') => {
    if (bias === 'over') return <Badge variant="outline" className="text-orange-600 border-orange-300">Over-estimating</Badge>
    if (bias === 'under') return <Badge variant="outline" className="text-blue-600 border-blue-300">Under-estimating</Badge>
    return <Badge variant="secondary">Neutral</Badge>
  }

  const formatCategory = (category: string) => {
    return category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  const getErrorSeverity = (absError: number) => {
    if (absError > 3) return 'destructive'
    if (absError > 1.5) return 'default'
    return 'secondary'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Error Pattern Analysis</h1>
        <p className="text-muted-foreground">
          Tracks where vision scoring is most accurate or inaccurate to inform corrections
        </p>
      </div>

      {/* Overall Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Samples</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patterns.totalSamples}</div>
            <p className="text-xs text-muted-foreground">verified predictions with ground truth</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Gross Error</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{patterns.overallGrossError.toFixed(1)}&quot;</span>
              {getBiasIcon(patterns.overallBias)}
            </div>
            {getBiasBadge(patterns.overallBias)}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Net Error</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patterns.overallNetError.toFixed(1)}&quot;</div>
            <p className="text-xs text-muted-foreground">after deductions applied</p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendations */}
      {patterns.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {patterns.recommendations.map((rec, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Error by Measurement Category
          </CardTitle>
          <CardDescription>
            Sorted by absolute error (worst at top)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {patterns.categoryErrors.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No error data available yet. Submit ground truth scores to see patterns.
            </p>
          ) : (
            <div className="space-y-4">
              {patterns.categoryErrors.map((category: CategoryError) => (
                <div key={category.category} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCategory(category.category)}</span>
                      {getBiasIcon(category.bias)}
                      <Badge variant={getErrorSeverity(category.avgAbsError)}>
                        {category.avgAbsError.toFixed(2)}&quot; avg error
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {category.sampleCount} samples ({category.percentOfSamples}%)
                    </span>
                  </div>
                  <Progress 
                    value={Math.min(100, (category.avgAbsError / 5) * 100)} 
                    className="h-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      Bias: {category.avgError > 0 ? '+' : ''}{category.avgError.toFixed(2)}&quot;
                    </span>
                    <span>
                      Suggested correction: {corrections[category.category] !== 0 
                        ? `${corrections[category.category] > 0 ? '+' : ''}${corrections[category.category].toFixed(2)}"` 
                        : 'none needed'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Best/Worst Categories */}
      {patterns.totalSamples > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400">
                Most Accurate Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCategory(patterns.bestCategory)}</div>
              <p className="text-sm text-muted-foreground">
                Lowest average error
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400">
                Needs Most Improvement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCategory(patterns.worstCategory)}</div>
              <p className="text-sm text-muted-foreground">
                Highest average error
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
