import {createClient} from '@supabase/supabase-js';
export function supabaseAdmin(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key) return null;return createClient(url,key,{auth:{persistSession:false}})}
export function supabaseBrowser(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key) return null;return createClient(url,key)}
