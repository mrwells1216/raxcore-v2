'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

interface ShareCollectionButtonProps {
  collectionId: string
  shareToken: string | null
  isPublic: boolean
}

export function ShareCollectionButton({ 
  collectionId, 
  shareToken: initialShareToken,
  isPublic: initialIsPublic 
}: ShareCollectionButtonProps) {
  const [open, setOpen] = useState(false)
  const [shareToken, setShareToken] = useState(initialShareToken)
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const router = useRouter()

  const shareUrl = shareToken 
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/collection/${shareToken}`
    : ''

  const handleGenerateLink = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      
      // Generate a random token
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      
      const { error } = await supabase
        .from('collections')
        .update({ 
          share_token: token,
          is_public: true 
        })
        .eq('id', collectionId)

      if (error) throw error

      setShareToken(token)
      setIsPublic(true)
      router.refresh()
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
        .from('collections')
        .update({ 
          share_token: null,
          is_public: false 
        })
        .eq('id', collectionId)

      if (error) throw error

      setShareToken(null)
      setIsPublic(false)
      router.refresh()
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
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Share Collection</DialogTitle>
          <DialogDescription>
            {shareToken 
              ? 'Anyone with this link can view your collection'
              : 'Create a shareable link for this collection'
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
                Generate a shareable link to allow others to view this collection
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
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Disable Sharing
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
