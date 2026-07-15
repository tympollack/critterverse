import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * USER-JWT CONTEXT
 * Forwards the caller's SunShade-minted JWT. RLS is fully enforced.
 * Use for any operation scoped to the calling user.
 */
export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('Missing Authorization header')
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false }
  })
}

/**
 * SERVICE-ROLE CONTEXT
 * Bypasses RLS. Must not be used for user-scoped operations.
 * Required comment: justify RLS bypass at each call site.
 */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })
}

/**
 * Decode and return the JWT payload from a request Authorization header.
 * Does NOT re-verify the signature — GoTrue already did that.
 * Use only for reading custom claims after auth.getUser() succeeds.
 */
export function decodeJwtPayload(req: Request): Record<string, unknown> {
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')
  return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
}

/**
 * Verify the calling user is authenticated and return their Critterverse UUID.
 * Throws a Response (to be returned directly) on auth failure.
 */
export async function requireAuth(
  req: Request
): Promise<{ userId: string; jwt: Record<string, unknown> }> {
  const client = userClient(req)
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const jwt = decodeJwtPayload(req)
  return { userId: user.id, jwt }
}
