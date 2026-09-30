import {redirect} from 'next/navigation';
import SetupProblem from '@/components/SetupProblem';
import CameraUpload from '@/components/upload/CameraUpload';
import {databaseUrl, one} from '@/lib/db';
import {UUID,latestLiveEventId,safely} from '@/lib/server';
export const dynamic='force-dynamic';
export default async function Upload({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;const eventId=p.event||'demo';
// No database configured: self-contained demo (nothing is saved).
if(!databaseUrl())return <CameraUpload eventId="demo"/>;
// Demo / missing link: send the guest to the event that is live right now.
if(eventId==='demo'){const r=await safely('upload',latestLiveEventId);if(r.failed)return <SetupProblem where="upload page"/>;if(r.value)redirect(`/upload?event=${r.value}`);return <Closed title="No event is live yet" text="Please scan the QR code on the big screen, or check back when the event starts."/>}
const r=UUID.test(eventId)?await safely('upload',()=>one<{name:string;status:string}>('select name,status from events where id=$1',[eventId])):{failed:false as const,value:null};
if(r.failed)return <SetupProblem where="upload page"/>;const event=r.value;
if(!event)return <Closed title="Event not found" text="Please check the link or scan the QR code again."/>;
if(event.status!=='live')return <Closed title={event.name} text={event.status==='ended'?'This event has ended. Thanks for taking part!':'Uploads open soon. Please check back when the event starts.'}/>;
return <CameraUpload eventId={eventId} eventName={event.name}/>}
function Closed({title,text}:{title:string;text:string}){return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6"><div className="max-w-md text-center"><p className="text-xs uppercase tracking-[.3em] text-zinc-500">Digital Mosaic Wall</p><h1 className="mt-4 text-3xl font-semibold">{title}</h1><p className="mt-3 text-zinc-400">{text}</p></div></main>}
