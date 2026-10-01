import {redirect} from 'next/navigation';
import MosaicWall from '@/components/MosaicWall';
import SetupProblem from '@/components/SetupProblem';
import {databaseUrl} from '@/lib/db';
import {latestLiveEventId,loadWall,safely} from '@/lib/server';
import type {WallData} from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Wall({searchParams}:{searchParams:Promise<{event?:string;simulate?:string;preview?:string}>}){const p=await searchParams;const eventId=p.event||'demo';
// The simulation is still available on purpose with ?simulate=1 (or when no database is configured).
if(p.simulate==='1'||!databaseUrl())return <MosaicWall eventId="demo" preview={p.preview==='1'}/>;
// Demo / missing link: show the event that is live right now, so phone uploads actually appear.
if(eventId==='demo'){const r=await safely('wall',latestLiveEventId);if(r.failed)return <SetupProblem where="wall"/>;if(r.value)redirect(`/wall?event=${r.value}`);return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6 text-center"><div className="max-w-md"><h1 className="text-3xl font-semibold">No event is live yet</h1><p className="mt-3 text-zinc-400">In /admin, open your event and press “Go live”. This page then shows it. To preview the animation without an event, add <code>?simulate=1</code>.</p></div></main>}
const r=await safely('wall',()=>loadWall(eventId));if(r.failed)return <SetupProblem where="wall"/>;const initial=r.value as WallData|null;
if(!initial)return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6 text-center"><div><h1 className="text-3xl font-semibold">Event not found</h1><p className="mt-3 text-zinc-400">Check the wall link in the admin dashboard.</p></div></main>;
// Plain JSON so dates etc. cross to the client component cleanly.
return <MosaicWall eventId={eventId} initial={JSON.parse(JSON.stringify(initial))}/>}
