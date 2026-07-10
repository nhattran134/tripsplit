import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Mutation {
  id: string
  type: 'insert' | 'soft_delete'
  table: string
  data: Record<string, unknown>
  version?: number
  timestamp: string
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

    const { mutations }: { mutations: Mutation[] } = await req.json()
    const results: { id: string; status: 'ok' | 'conflict' | 'error'; error?: string }[] = []

    const allowedTables = ['deposits', 'expenses', 'expense_splits', 'settlements']

    for (const mutation of mutations) {
      try {
        // Validate table name to prevent injection
        if (!allowedTables.includes(mutation.table)) {
          results.push({ id: mutation.id, status: 'error', error: `Invalid table: ${mutation.table}` })
          continue
        }

        if (mutation.type === 'insert') {
          const { error } = await supabase
            .from(mutation.table)
            .insert(mutation.data)

          results.push({ id: mutation.id, status: error ? 'error' : 'ok', error: error?.message })
        } else if (mutation.type === 'soft_delete') {
          // Only delete if not already deleted (prevents duplicate edits)
          const { data, error } = await supabase
            .from(mutation.table)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', mutation.data.id as string)
            .is('deleted_at', null)
            .select()

          if (error) {
            results.push({ id: mutation.id, status: 'error', error: error.message })
          } else if (!data || data.length === 0) {
            results.push({ id: mutation.id, status: 'conflict', error: 'Record already deleted or modified' })
          } else {
            results.push({ id: mutation.id, status: 'ok' })
          }
        }
      } catch (e) {
        results.push({ id: mutation.id, status: 'error', error: String(e) })
      }
    }

    return new Response(JSON.stringify({ results }), { headers: corsHeaders })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: corsHeaders })
  }
})
