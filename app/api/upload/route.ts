import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {databaseUrl, one, saveImage} from '@/lib/db';
import {UUID,cleanText,clientIp,fail,latestLiveEventId,rateLimited} from '@/lib/server';
export const runtime='nodejs';
export const maxDuration=30;
// Vercel rejects request bodies over 4.5 MB; the client downsizes photos before sending.
const MAX_BYTES=4*1024*1024;
// Formats sharp can decode out of the box. HEIC is converted to JPEG in the browser first.
const FORMATS=new Set(['jpeg','png','webp','gif','avif','tiff']);

export async function POST(req:Request){try{
if(rateLimited(clientIp(req)))return fail("You're uploading very quickly. Please wait a minute and try again.",429);
const fd=await req.formData();const file=fd.get('file');let eventId=String(fd.get('eventId')||'');
const name=cleanText(fd.get('name'),60);const message=cleanText(fd.get('message'),140);
if(!(file instanceof File)||file.size===0)return fail('Please choose a photo.',400);
if(file.size>MAX_BYTES)return fail('That photo is too large (over 4 MB). Please try again.',413);
if(!databaseUrl())return NextResponse.json({ok:true,status:'demo',message:'Demo upload accepted'});
// Demo / missing links go to whichever event is live, instead of silently discarding the photo.
if(!eventId||eventId==='demo'){const live=await latestLiveEventId();if(!live)return fail('No event is accepting photos right now. Please scan the QR code on the big screen.',409);eventId=live}
if(!UUID.test(eventId))return fail('This upload link is not valid. Please scan the QR code again.',400);
const event=await one<{id:string;status:string;auto_approve:boolean}>('select id,status,auto_approve from events where id=$1',[eventId]);
if(!event)return fail('Event not found. Please scan the QR code again.',404);
if(event.status!=='live')return fail('This event is not accepting photos right now.',403);

// Validate by decoding the actual bytes, not the MIME type the phone reports.
let full:Buffer,thumb:Buffer;try{const input=Buffer.from(await file.arrayBuffer());const meta=await sharp(input).metadata();
if(!meta.format||!FORMATS.has(meta.format)||!meta.width||!meta.height)return fail('That file is not a supported photo. Please use a JPG, PNG or WEBP image.',415);
const img=sharp(input,{animated:false}).rotate();
// Sized to keep ~750 photos well inside the free database (0.5 GB).
full=await img.clone().resize(1200,1200,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80,mozjpeg:true}).toBuffer();
thumb=await img.clone().resize(240,240,{fit:'cover',position:'attention'}).jpeg({quality:75,mozjpeg:true}).toBuffer()}
catch{return fail('Could not read that photo. Please try another one.',415)}

const image_url=await saveImage(eventId,full);const thumbnail_url=await saveImage(eventId,thumb);
const sub=await one<{id:string}>("insert into submissions(event_id,image_url,thumbnail_url,name,message,status) values($1,$2,$3,$4,$5,'pending') returning id",[eventId,image_url,thumbnail_url,name,message]);
let status:'pending'|'approved'|'waiting'='pending';
if(event.auto_approve||process.env.AUTO_APPROVE==='true'){const r=await one<{tile_index:number|null}>('select tile_index from approve_submission($1)',[sub!.id]);
// Approved but the grid is full: it waits for a free tile.
status=r?.tile_index==null?'waiting':'approved'}
return NextResponse.json({ok:true,id:sub!.id,eventId,status})}catch(e){return fail(e)}}
