import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {isAdmin} from './auth';
import {one, q} from './db';

export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function fail(e:unknown,status=500){const message=e instanceof Error?e.message:e&&typeof e==='object'&&'message' in e?String((e as {message:unknown}).message):typeof e==='string'?e:'Request failed';if(status>=500)console.error('[api]',e);return NextResponse.json({error:message},{status})}

/** Use at the top of every /api/admin handler. */
export async function adminGuard():Promise<NextResponse|null>{return (await isAdmin({cookies:await cookies()}))?null:NextResponse.json({error:'Unauthorized'},{status:401})}

export async function approvedTiles(eventId:string){return q<{id:string;thumbnail_url:string;tile_index:number}>("select id,thumbnail_url,tile_index from submissions where event_id=$1 and status='approved' and tile_index is not null order by tile_index",[eventId])}
export async function loadWall(eventId:string){if(!UUID.test(eventId))return null;const event=await one('select * from events where id=$1',[eventId]);if(!event)return null;return {event,tiles:await approvedTiles(eventId)}}
export async function statusCounts(eventId:string){const r=await one<{pending:number;approved:number;rejected:number}>("select count(*) filter(where status='pending')::int pending,count(*) filter(where status='approved')::int approved,count(*) filter(where status='rejected')::int rejected from submissions where event_id=$1",[eventId]);return r??{pending:0,approved:0,rejected:0}}

// Links without a real event ID (?event=demo, or none at all) resolve to the most
// recently created live event, so old QR codes and the home-page buttons still work.
export async function latestLiveEventId():Promise<string|null>{return (await one<{id:string}>("select id from events where status='live' order by created_at desc limit 1"))?.id??null}
/** Runs a database read for a page; on failure logs it (Vercel → Logs) so the page can show the setup check instead of crashing. */
export async function safely<T>(what:string,fn:()=>Promise<T>):Promise<{failed:false;value:T}|{failed:true}>{try{return {failed:false,value:await fn()}}catch(e){console.error(`[${what}] database error`,e);return {failed:true}}}

// Best-effort per-IP limiter. Serverless instances don't share memory, so this
// stops a single phone spamming uploads, not a coordinated attack.
const hits=new Map<string,number[]>();
export function rateLimited(ip:string,limit=8,windowMs=60_000){const now=Date.now();const recent=(hits.get(ip)||[]).filter(t=>now-t<windowMs);recent.push(now);hits.set(ip,recent);if(hits.size>5000)hits.clear();return recent.length>limit}
export function clientIp(req:Request){return req.headers.get('x-forwarded-for')?.split(',')[0].trim()||req.headers.get('x-real-ip')||'unknown'}
// Strip control characters and collapse whitespace in guest-supplied text.
export function cleanText(v:FormDataEntryValue|null,max:number){if(typeof v!=='string')return null;const s=v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);return s||null}
