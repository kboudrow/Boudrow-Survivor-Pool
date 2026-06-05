import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { stripe } from '@/lib/stripe'

type CheckoutRequestBody = {
  poolId?: string
}

export async function POST(request: Request) {
  try {
    const { poolId } = (await request.json()) as CheckoutRequestBody
    if (!poolId) {
      return NextResponse.json({ error: 'Missing pool id.' }, { status: 400 })
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
      .select('id,name,created_by,activation_status,payment_status,archived,stripe_checkout_session_id')
      .eq('id', poolId)
      .maybeSingle()

    if (poolError) throw poolError
    if (!pool) {
      return NextResponse.json({ error: 'Pool not found.' }, { status: 404 })
    }
    if (pool.created_by !== user.id) {
      return NextResponse.json({ error: 'Only the pool creator can activate this pool.' }, { status: 403 })
    }
    if (pool.archived) {
      return NextResponse.json({ error: 'Archived pools cannot be activated.' }, { status: 400 })
    }
    if (pool.activation_status === 'active') {
      return NextResponse.json({ error: 'This pool is already active.' }, { status: 400 })
    }

    const priceId = process.env.STRIPE_POOL_ACTIVATION_PRICE_ID
    if (!priceId) {
      return NextResponse.json({ error: 'Stripe price is not configured.' }, { status: 500 })
    }

    const origin = new URL(request.url).origin
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: pool.id,
      customer_email: user.email ?? undefined,
      metadata: {
        pool_id: pool.id,
        user_id: user.id,
        purpose: 'pool_activation',
      },
      success_url: `${origin}/pools/${pool.id}/admin?activated=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pools/${pool.id}/admin?activated=cancelled`,
    })

    const { error: updateError } = await supabaseAdmin
      .from('pools')
      .update({
        stripe_checkout_session_id: session.id,
        payment_status: 'unpaid',
      })
      .eq('id', pool.id)

    if (updateError) throw updateError

    return NextResponse.json({ url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
