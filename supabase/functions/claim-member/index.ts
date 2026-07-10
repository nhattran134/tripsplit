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

    // Get the calling user
    const authHeader = req.headers.get('Authorization')!
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { member_id, pin, trip_id } = await req.json()

    if (!member_id || !pin || !trip_id) {
      return new Response(JSON.stringify({ error: 'member_id, pin, and trip_id are required' }), { status: 400, headers: corsHeaders })
    }

    // Fetch the target member
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('id, member_token, trip_id, name')
      .eq('id', member_id)
      .eq('trip_id', trip_id)
      .is('deleted_at', null)
      .single()

    if (memberError || !member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers: corsHeaders })
    }

    // Verify PIN (case-insensitive)
    if (!member.member_token || member.member_token.toUpperCase() !== pin.trim().toUpperCase()) {
      return new Response(JSON.stringify({ error: 'Invalid PIN' }), { status: 403, headers: corsHeaders })
    }

    // Remove this auth_uid from any OTHER member's sessions in the same trip
    // (one device = one identity per trip)
    const { data: otherMembers } = await supabase
      .from('member_sessions')
      .select('id, member_id, members!inner(trip_id)')
      .eq('members.trip_id', trip_id)
      .eq('auth_uid', user.id)
      .neq('member_id', member_id)

    if (otherMembers && otherMembers.length > 0) {
      await supabase
        .from('member_sessions')
        .delete()
        .in('id', otherMembers.map((s: any) => s.id))
    }

    // Add this device session to the member (upsert - ignore if already exists)
    await supabase
      .from('member_sessions')
      .upsert({ member_id: member_id, auth_uid: user.id }, { onConflict: 'member_id,auth_uid' })

    // Also update the legacy auth_uid on the member record (for backward compat)
    await supabase
      .from('members')
      .update({ auth_uid: user.id, claimed: true })
      .eq('id', member_id)

    return new Response(JSON.stringify({ success: true, member_name: member.name }), { headers: corsHeaders })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: corsHeaders })
  }
})
