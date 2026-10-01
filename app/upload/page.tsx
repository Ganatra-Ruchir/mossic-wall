import {redirect} from 'next/navigation';
import SetupProblem from '@/components/SetupProblem';
import CameraUpload from '@/components/upload/CameraUpload';
import {databaseUrl, one} from '@/lib/db';
import {UUID,latestLiveEventId,safely} from '@/lib/server';
import {normalizeDesign} from '@/lib/design';
export const dynamic='force-dynamic';
export default async function Upload({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;const eventId=p.event||'demo';
// No database configured: self-contained demo (nothing is saved).
if(!databaseUrl())return <CameraUpload eventId="demo"/>;
// Demo / missing link: send the guest to the event that is live right now.
if(eventId==='demo'){const r=await safely('upload',latestLiveEventId);if(r.failed)return <SetupProblem where="upload page"/>;if(r.value)redirect(`/upload?event=${r.value}`);return <Closed title="No event is live yet" text="Please scan the QR code on the big screen, or check back when the event starts."/>}
const r=UUID.test(eventId)?await safely('upload',()=>one<{name:string;status:string;design:unknown;final_image_url:string|null}>('select name,status,design,final_image_url from events where id=$1',[eventId])):{failed:false as const,value:null};
if(r.failed)return <SetupProblem where="upload page"/>;const event=r.value;
if(!event)return <Closed title="Event not found" text="Please check the link or scan the QR code again."/>;
// After the event: the finished picture (if the host shared it) with a download button.
if(event.status==='ended'&&event.final_image_url)return <Finished name={event.name} url={event.final_image_url} bg={normalizeDesign(event.design).background}/>;
if(event.status!=='live')return <Closed title={event.name} text={event.status==='ended'?'This event has ended. Thanks for taking part!':'Uploads open soon. Please check back when the event starts.'}/>;
const d=normalizeDesign(event.design);return <CameraUpload eventId={eventId} eventName={event.name} theme={{background:d.background,accent:d.accent}}/>}
function Closed({title,text}:{title:string;text:string}){return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6"><div className="max-w-md text-center"><p className="text-xs uppercase tracking-[.3em] text-zinc-500">Digital Mosaic Wall</p><h1 className="mt-4 text-3xl font-semibold">{title}</h1><p className="mt-3 text-zinc-400">{text}</p></div></main>}

function Finished({name,url,bg}:{name:string;url:string;bg:string}){return <main className="min-h-screen p-5 text-white" style={{background:bg}}><div className="mx-auto max-w-2xl py-8 text-center">
<p className="text-xs uppercase tracking-[.3em] text-white/60">{name}</p><h1 className="mt-3 text-3xl font-semibold">We did it together!</h1><p className="mt-2 text-white/75">Here’s the picture everyone made. Thanks for taking part.</p>
{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={url} alt="The finished mosaic" className="mt-6 w-full rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,.45)]"/>
<a href={url} download="mosaic.jpg" className="mt-6 inline-block rounded-full bg-white px-6 py-3.5 font-semibold text-black">Download the picture</a></div></main>}
