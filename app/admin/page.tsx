import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import AdminDashboard from '@/components/AdminDashboard';
import AdminEvents from '@/components/AdminEvents';
import SetupProblem from '@/components/SetupProblem';
import {isAdmin} from '@/lib/auth';
import {databaseUrl,ensureSchema} from '@/lib/db';
import {safely} from '@/lib/server';
export const dynamic='force-dynamic';
export default async function Admin({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;
if(!databaseUrl())return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6 text-center"><div className="max-w-md"><h1 className="text-2xl font-semibold">No database connected</h1><p className="mt-3 text-sm text-zinc-400">In Vercel → Storage, create or connect a Neon database to this project, then redeploy.</p></div></main>;
const ready=await safely('admin',ensureSchema);if(ready.failed)return <SetupProblem where="admin"/>;
if(!(await isAdmin({cookies:await cookies()})))redirect('/admin/login');
return p.event?<AdminDashboard eventId={p.event}/>:<AdminEvents/>}
