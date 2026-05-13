'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SCORE_SOURCES } from '@/lib/constants'
import type { GroundTruthFormData } from '@/lib/types'

const formSchema = z.object({
  official_gross: z.coerce.number().min(0).max(400).nullable(),
  official_net: z.coerce.number().min(0).max(400).nullable(),
  score_source: z.enum(['official_scorer', 'self_measured', 'user_reported', 'estimated']),
  scorer_name: z.string().optional(),
  scoring_organization: z.string().optional(),
  harvest_year: z.coerce.number().min(1900).max(new Date().getFullYear()).optional(),
  notes: z.string().optional(),
})

interface GroundTruthFormProps {
  onSubmit: (data: GroundTruthFormData) => void
  onCancel: () => void
  isSubmitting: boolean
}

export function GroundTruthForm({ onSubmit, onCancel, isSubmitting }: GroundTruthFormProps) {
  const form = useForm<GroundTruthFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      official_gross: null,
      official_net: null,
      score_source: 'user_reported',
    },
  })

  const scoreSource = form.watch('score_source')
  const showScorerFields = scoreSource === 'official_scorer'

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Scores */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="official_gross"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Gross Score</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 165.5"
                    className="min-h-[48px]"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="official_net"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Net Score</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 158.25"
                    className="min-h-[48px]"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Score Source */}
        <FormField
          control={form.control}
          name="score_source"
          render={({ field }) => (
            <FormItem>
              <FormLabel>How was this measured?</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="min-h-[48px]">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SCORE_SOURCES.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Official Scorer Fields */}
        {showScorerFields && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="scorer_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scorer Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Optional" 
                      className="min-h-[48px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="scoring_organization"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="B&C, P&Y, etc." 
                      className="min-h-[48px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Harvest Year */}
        <FormField
          control={form.control}
          name="harvest_year"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Harvest Year</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="e.g. 2024"
                  className="min-h-[48px]"
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Any additional details..."
                  className="min-h-[80px] resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button 
            type="button"
            variant="outline" 
            onClick={onCancel}
            className="flex-1 min-h-[48px]"
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            className="flex-1 min-h-[48px]"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Submitting...
              </>
            ) : (
              'Submit Score'
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}
