import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { stripe } from '@/lib/stripe'

type ConfirmRequestBody = {
  poolId?: string
  sessionId?: string
}

export async function POST(request: Request) {
  try {
    const { poolId, sessionId } = (await request.json()) as ConfirmRequestBody
    if (!poolId || !sessionId) {
      return NextResponse.json({ error: 'Missing checkout confirmation details.' }, { status: 400 })
    }

    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
    if (!token) {
      return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 })
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 })
    }

    const { data: pool, error: poolError } = await supabaseAdmin
      .from('pools')
      .select('id,created_by,activation_status')
      .eq('id', poolId)
      .maybeSingle()

    if (poolError) throw poolError
    if (!pool) {
      return NextResponse.json({ error: 'Pool not found.' }, { status: 404 })
    }
    if (pool.created_by !== user.id) {
      return NextResponse.json({ error: 'Only the pool creator can activate this pool.' }, { status: 403 })
    }

    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
    const metadataPoolId = checkoutSession.metadata?.pool_id
    const metadataUserId = checkoutSession.metadata?.user_id

    if (metadataPoolId !== pool.id || metadataUserId !== user.id) {
      return NextResponse.json({ error: 'Checkout session does not match this pool.' }, { status: 400 })
    }
    if (checkoutSession.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Checkout has not been paid yet.' }, { status: 400 })
    }

    const { error: updateError } = await supabaseAdmin
      .from('pools')
      .update({
        activation_status: 'active',
        activated_at: new Date().toISOString(),
        activated_by: user.id,
        payment_status: 'paid',
        stripe_checkout_session_id: checkoutSession.id,
        stripe_payment_intent_id: typeof checkoutSession.payment_intent === 'string' ? checkoutSession.payment_intent : null,
      })
      .eq('id', pool.id)
      .eq('created_by', user.id)

    if (updateError) throw updateError

    return NextResponse.json({ activated: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout confirmation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
