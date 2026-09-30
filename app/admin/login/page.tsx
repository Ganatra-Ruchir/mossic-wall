'use client';
import {useEffect,useState} from 'react';
// First run (no ADMIN_PASSWORD in Vercel and none created yet): create the password here.
export default function Login(){const [mode,setMode]=useState<'env'|'db'|'none'|null>(null);const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
useEffect(()=>{fetch('/api/admin/login').then(r=>r.json()).then(j=>setMode(j.mode??'db')).catch(()=>setMode('db'))},[]);
const creating=mode==='none';
async function submit(e:React.FormEvent){e.preventDefault();setError('');if(creating&&password!==confirm){setError('The two passwords do not match.');return}setBusy(true);
const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,create:creating})});if(r.ok){window.location.href='/admin';return}
setError((await r.json().catch(()=>({}))).error||'Login failed');setBusy(false)}
return <main className="grid min-h-screen place-items-center bg-[#08090b] p-6"><form onSubmit={submit} className="glass w-full max-w-sm rounded-3xl p-6"><p className="text-xs uppercase tracking-[.35em] text-zinc-500">Control room</p><h1 className="mt-2 text-2xl font-semibold">{creating?'Create admin password':'Admin login'}</h1>
{creating&&<p className="mt-2 text-sm text-zinc-400">First time here: choose the password for this dashboard. You’ll use it to log in from now on.</p>}
<input autoFocus type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={creating?'New password (8+ characters)':'Password'} autoComplete={creating?'new-password':'current-password'} className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm"/>
{creating&&<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat password" autoComplete="new-password" className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm"/>}
<button disabled={!password||busy||mode===null} className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40">{busy?'Checking…':creating?'Create and log in':'Log in'}</button>{error&&<p className="mt-3 text-sm text-red-300">{error}</p>}</form></main>}
