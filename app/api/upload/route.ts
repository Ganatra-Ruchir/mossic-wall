import {NextResponse} from 'next/server';
import {createHash,randomBytes} from 'node:crypto';
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
// Generous: guests at one venue often share a single Wi-Fi address, and one guest may send 20 at once.
if(rateLimited(clientIp(req),60))return fail("You're uploading very quickly. Please wait a minute and try again.",429);
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
// A private key the guest's phone keeps, so that phone (and only it) can remove the photo later.
const deleteToken=randomBytes(24).toString('hex');
const sub=await one<{id:string}>("insert into submissions(event_id,image_url,thumbnail_url,name,message,status,delete_token_hash) values($1,$2,$3,$4,$5,'pending',$6) returning id",[eventId,image_url,thumbnail_url,name,message,createHash('sha256').update(deleteToken).digest('hex')]);
let status:'pending'|'approved'|'waiting'='pending';
if(event.auto_approve||process.env.AUTO_APPROVE==='true'){const r=await one<{tile_index:number|null}>('select tile_index from approve_submission($1)',[sub!.id]);
// Approved but the grid is full: it waits for a free tile.
status=r?.tile_index==null?'waiting':'approved'}
const ev=await one<{approved_count:number;goal:number}>('select approved_count,goal from events where id=$1',[eventId]);
return NextResponse.json({ok:true,id:sub!.id,eventId,status,deleteToken,thumbnailUrl:thumbnail_url,count:ev?.approved_count??0,goal:ev?.goal??150})}catch(e){return fail(e)}}

// "Remove my photo": only the phone that uploaded it has the key.
export async function DELETE(req:Request){try{
if(rateLimited('del:'+clientIp(req),30))return fail('Too many requests. Please wait a minute.',429);
const {id,token}=await req.json().catch(()=>({}));
if(typeof id!=='string'||!UUID.test(id)||typeof token!=='string'||!/^[0-9a-f]{48}$/.test(token))return fail('Invalid request',400);
const row=await one<{delete_token_hash:string|null}>('select delete_token_hash from submissions where id=$1',[id]);
if(!row)return NextResponse.json({ok:true}); // already gone
if(!row.delete_token_hash||row.delete_token_hash!==createHash('sha256').update(token).digest('hex'))return fail('This photo can only be removed from the phone that sent it.',403);
await one('select delete_submission($1)',[id]);
return NextResponse.json({ok:true})}catch(e){return fail(e)}}
