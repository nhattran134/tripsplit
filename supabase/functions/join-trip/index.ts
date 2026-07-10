import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')!
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { invite_code, name, pin } = await req.json()

    // Find trip by invite code
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, pin_hash')
      .eq('invite_code', invite_code)
      .is('archived_at', null)
      .single()

    if (tripError || !trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404, headers: corsHeaders })
    }

    // Verify PIN if set
    if (trip.pin_hash) {
      const encoder = new TextEncoder()
      const data = encoder.encode(pin || '')
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      if (hashHex !== trip.pin_hash) {
        return new Response(JSON.stringify({ error: 'Invalid PIN' }), { status: 403, headers: corsHeaders })
      }
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('members')
      .select('id, name')
      .eq('trip_id', trip.id)
      .eq('auth_uid', user.id)
      .is('deleted_at', null)
      .single()

    if (existing) {
      return new Response(JSON.stringify({ member: existing, trip_id: trip.id }), { headers: corsHeaders })
    }

    // Assign random avatar color
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']
    const color = colors[Math.floor(Math.random() * colors.length)]

    // Create member (trigger will set is_admin for first member)
    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({ trip_id: trip.id, auth_uid: user.id, name, color })
      .select()
      .single()

    if (memberError) {
      return new Response(JSON.stringify({ error: memberError.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ member, trip_id: trip.id }), { headers: corsHeaders })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: corsHeaders })
  }
})
