import Stripe from 'stripe'
import { cleanEnvValue } from '@/lib/env'

const stripeSecretKey = cleanEnvValue(process.env.STRIPE_SECRET_KEY)

if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY.')
}

export const stripe = new Stripe(stripeSecretKey)
