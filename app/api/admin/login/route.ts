import {NextResponse} from 'next/server';
import {ADMIN_COOKIE,SESSION_MAX_AGE,checkPassword,createPassword,createSession,passwordMode} from '@/lib/auth';
import {clientIp,fail,rateLimited} from '@/lib/server';
function withSession(token:string){const res=NextResponse.json({ok:true});res.cookies.set(ADMIN_COOKIE,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:SESSION_MAX_AGE});return res}
/** Tells the login page whether to show "create a password" (first run) or "log in". */
export async function GET(){try{return NextResponse.json({mode:await passwordMode()})}catch(e){return fail(e)}}
export async function POST(req:Request){try{if(rateLimited('login:'+clientIp(req),10))return fail('Too many attempts. Please wait a minute.',429);
const {password,create}=await req.json().catch(()=>({password:''}));if(typeof password!=='string'||!password)return fail('Password is required',400);
if(create){if(password.length<8)return fail('Use at least 8 characters',400);if(!(await createPassword(password)))return fail('An admin password already exists. Log in instead.',409);return withSession(await createSession())}
if(!(await checkPassword(password)))return fail('Wrong password',401);return withSession(await createSession())}catch(e){return fail(e)}}
export async function DELETE(){const res=NextResponse.json({ok:true});res.cookies.delete(ADMIN_COOKIE);return res}
