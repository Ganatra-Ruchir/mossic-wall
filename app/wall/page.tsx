import MosaicWall from '@/components/MosaicWall';
import {loadWall} from '@/lib/server';
import type {WallData} from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Wall({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;const eventId=p.event||'demo';if(eventId==='demo')return <MosaicWall eventId="demo"/>;
const initial=await loadWall(eventId) as WallData|null;
if(!initial)return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6 text-center"><div><h1 className="text-3xl font-semibold">Event not found</h1><p className="mt-3 text-zinc-400">Check the wall link in the admin dashboard.</p></div></main>;
return <MosaicWall eventId={eventId} initial={initial}/>}
