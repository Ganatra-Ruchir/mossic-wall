import AdminDashboard from '@/components/AdminDashboard';
import AdminEvents from '@/components/AdminEvents';
import {supabaseAdmin} from '@/lib/supabase';
export const dynamic='force-dynamic';
export default async function Admin({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;
if(!supabaseAdmin())return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6 text-center"><div className="max-w-md"><h1 className="text-2xl font-semibold">Supabase is not configured</h1><p className="mt-3 text-sm text-zinc-400">Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, then restart.</p></div></main>;
return p.event?<AdminDashboard eventId={p.event}/>:<AdminEvents/>}
