// Optional Supabase client. If the two env vars are not set at build time,
// `supabase` is null and the app falls back to localStorage (see store.js).
//
// Set these in a local .env file and as GitHub Actions secrets for deploys:
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJ...
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null
export const isShared = !!supabase
