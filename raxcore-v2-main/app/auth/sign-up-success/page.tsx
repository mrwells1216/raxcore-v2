import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Mail, ArrowLeft } from 'lucide-react'

export default function SignUpSuccessPage() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center p-6 md:p-10 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card className="border-border/50">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
                  <Mail className="h-6 w-6" />
                </div>
              </div>
              <CardTitle className="text-2xl">Check your email</CardTitle>
              <CardDescription>
                We&apos;ve sent you a confirmation link
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground text-center">
                Click the link in the email to verify your account. Once confirmed, 
                you can sign in and start saving your scored bucks to your library.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline" className="min-h-[48px]">
                  <Link href="/auth/login">
                    Go to login
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="min-h-[48px]">
                  <Link href="/" className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to home
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
