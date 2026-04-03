'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Share2, Copy, Check, Loader2, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface ShareBuckButtonProps {
  buckId: string
  shareToken?: string | null
  isPublic?: boolean
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  className?: string
}

export function ShareBuckButton({ 
  buckId, 
  shareToken: initialShareToken,
  isPublic: initialIsPublic = false,
  variant = 'outline',
  size = 'sm',
  className
}: ShareBuckButtonProps) {
  const [open, setOpen] = useState(false)
  const [shareToken, setShareToken] = useState(initialShareToken)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareUrl = shareToken 
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareToken}`
    : ''

  const handleGenerateLink = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      
      // Generate a random token
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      
      const { error } = await supabase
        .from('bucks')
        .update({ 
          share_token: token,
          is_public: true 
        })
        .eq('id', buckId)

      if (error) throw error

      setShareToken(token)
      toast.success('Share link created!')
    } catch (err) {
      toast.error('Failed to generate share link')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast.success('Link copied to clipboard!')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      toast.error('Failed to copy link')
    }
  }

  const handleDisableSharing = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      
      const { error } = await supabase
        .from('bucks')
        .update({ 
          share_token: null,
          is_public: false 
        })
        .eq('id', buckId)

      if (error) throw error

      setShareToken(null)
      toast.success('Sharing disabled')
      setOpen(false)
    } catch (err) {
      toast.error('Failed to disable sharing')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Share2 className="h-4 w-4" />
          {size !== 'icon' && <span className="ml-2">Share</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Share This Score</DialogTitle>
          <DialogDescription>
            {shareToken 
              ? 'Anyone with this link can view your buck and its AI score'
              : 'Create a shareable link for this scored buck'
            }
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {shareToken ? (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="share-link">Share Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="share-link"
                    value={shareUrl}
                    readOnly
                    className="text-sm"
                  />
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={handleCopy}
                    className="flex-shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <Button 
                variant="outline" 
                className="w-full" 
                asChild
              >
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Link
                </a>
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Generate a link to share this buck&apos;s AI score with friends and family
              </p>
              <Button onClick={handleGenerateLink} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Share2 className="mr-2 h-4 w-4" />
                    Generate Share Link
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
        {shareToken && (
          <DialogFooter>
            <Button 
              variant="destructive" 
              onClick={handleDisableSharing}
              disabled={loading}
              size="sm"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable Sharing
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
