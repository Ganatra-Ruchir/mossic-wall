import UploadClient from '@/components/UploadClient';
import {supabaseAdmin} from '@/lib/supabase';
import {UUID} from '@/lib/server';
export const dynamic='force-dynamic';
export default async function Upload({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;const eventId=p.event||'demo';const sb=supabaseAdmin();
if(!sb||eventId==='demo')return <UploadClient eventId={eventId}/>;
const {data:event}=UUID.test(eventId)?await sb.from('events').select('name,status').eq('id',eventId).maybeSingle():{data:null};
if(!event)return <Closed title="Event not found" text="Please check the link or scan the QR code again."/>;
if(event.status!=='live')return <Closed title={event.name} text={event.status==='ended'?'This event has ended. Thanks for taking part!':'Uploads open soon. Please check back when the event starts.'}/>;
return <UploadClient eventId={eventId} eventName={event.name}/>}
function Closed({title,text}:{title:string;text:string}){return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6"><div className="max-w-md text-center"><p className="text-xs uppercase tracking-[.3em] text-zinc-500">Digital Mosaic Wall</p><h1 className="mt-4 text-3xl font-semibold">{title}</h1><p className="mt-3 text-zinc-400">{text}</p></div></main>}
