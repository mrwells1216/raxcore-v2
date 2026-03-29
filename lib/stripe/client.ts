import 'server-only'

import Stripe from 'stripe'

// Initialize Stripe with secret key - use test key placeholder if not set
const stripeSecretKey = process.env.STRIPE_SECRET_KEY

// Create stripe instance only if key is available
export const stripe = stripeSecretKey 
  ? new Stripe(stripeSecretKey)
  : null as unknown as Stripe

// Helper to check if Stripe is configured
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}
