'use client';
import '@fontsource-variable/bricolage-grotesque';
import {AnimatePresence, motion} from 'framer-motion';
import QRCode from 'qrcode';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {WallData} from '@/lib/types';
import {WallEngine, type WallPhoto} from './WallEngine';

const DEFAULT_TARGET = '/targets/micron.jpg';
const FONT = '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif';

type Props = {eventId: string; initial?: WallData; demo?: boolean};

export default function LiveMosaic({eventId, initial, demo = false}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WallEngine | null>(null);
  const placeRef = useRef<() => void>(() => {});
  const [data, setData] = useState<WallData | undefined>(initial);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<'gallery' | 'revealing' | 'mosaic'>('gallery');
  const [flying, setFlying] = useState<WallPhoto | null>(null);
  const [qr, setQr] = useState('');
  const [clean, setClean] = useState(false); // fullscreen: only the mosaic
  const [idle, setIdle] = useState(false);   // hide the cursor and button when the mouse rests
  const cleanRef = useRef(false);
  const event = data?.event;
  const goal = Math.max(2, Math.min(event?.goal ?? 150, event?.total_slots ?? 150));
  const title = demo ? 'Micron' : event?.name ?? '';

  // Engine lifecycle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const e = new WallEngine(canvas, goal, {onCount: setCount, onPhase: setPhase, onFlight: setFlying}, Number(event?.animation_speed) || 1);
    engineRef.current = e;
    e.setTarget(event?.target_image_url || DEFAULT_TARGET);
    const place = () => {
      e.resize();
      if (cleanRef.current) { const m = Math.max(12, window.innerHeight * 0.02); e.setArea(m, m); return; }
      const top = (headerRef.current?.getBoundingClientRect().bottom ?? 80) + 12;
      const bottom = window.innerHeight - (footerRef.current?.getBoundingClientRect().top ?? window.innerHeight - 90) + 12;
      e.setArea(top, bottom);
    };
    placeRef.current = place;
    place();
    const ro = new ResizeObserver(place);
    ro.observe(document.body);
    return () => { ro.disconnect(); e.destroy(); engineRef.current = null; };
    // The engine is created once; later changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { engineRef.current?.setGoal(goal); }, [goal]);
  useEffect(() => { engineRef.current?.setFlyFrom(event?.fly_from ?? 'random'); }, [event?.fly_from]);

  // Fullscreen = clean mode: header, QR, counter and captions disappear; the mosaic fills the screen.
  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement;
      cleanRef.current = on;
      setClean(on);
      requestAnimationFrame(() => placeRef.current());
    };
    const toggle = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => {}); };
    const onKey = (e: KeyboardEvent) => { if ((e.key === 'f' || e.key === 'F') && !(e.target instanceof HTMLInputElement)) toggle(); };
    toggleRef.current = toggle;
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    const onDbl = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('button,input,a')) toggle(); };
    window.addEventListener('dblclick', onDbl);
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKey); window.removeEventListener('dblclick', onDbl); };
  }, []);

  // Big-screen manners: hide the cursor after 3 s still; keep the display awake while the wall is open.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    wake();
    window.addEventListener('mousemove', wake);
    let lock: {release: () => Promise<void>} | null = null;
    const nav = navigator as Navigator & {wakeLock?: {request: (type: 'screen') => Promise<{release: () => Promise<void>}>}};
    const grab = () => { if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); document.removeEventListener('visibilitychange', grab); lock?.release().catch(() => {}); };
  }, []);
  useEffect(() => { if (event?.target_image_url) engineRef.current?.setTarget(event.target_image_url); }, [event?.target_image_url]);

  // Photos already on the wall at load appear at once; later ones fly in.
  const first = useRef(true);
  useEffect(() => {
    if (!data || !engineRef.current) return;
    engineRef.current.sync(data.tiles.map((t) => ({id: t.id, thumb: t.thumbnail_url, full: t.image_url, name: t.name, message: t.message})), !first.current);
    first.current = false;
  }, [data]);

  // Live updates: check for new photos every 3 s.
  const toggleRef = useRef<() => void>(() => {});
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/wall/${eventId}`, {cache: 'no-store'});
      if (r.ok) setData(await r.json());
    } catch { /* keep showing what we have; next poll retries */ }
  }, [eventId]);
  useEffect(() => {
    if (demo) return;
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const iv = setInterval(tick, 3000);
    return () => clearInterval(iv);
  }, [refresh, demo]);

  useEffect(() => {
    const url = demo ? `${window.location.origin}/upload` : `${window.location.origin}/upload?event=${eventId}`;
    QRCode.toDataURL(url, {width: 360, margin: 1, color: {dark: '#2b0a4a', light: '#ffffff'}}).then(setQr).catch(() => {});
  }, [eventId, demo]);

  const done = phase !== 'gallery';
  const pct = Math.min(100, (count / goal) * 100);
  const left = Math.max(0, goal - count);

  return (
    <main className="fixed inset-0 overflow-hidden text-white" style={{fontFamily: FONT, background: '#1d0633', cursor: idle ? 'none' : undefined}}>
      <Backdrop />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <header ref={headerRef} className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-[3vw] pt-[3.2vh] transition-opacity duration-500 ${clean ? 'opacity-0' : ''}`}>
        <div>
          <h1 className="text-[4.2vh] font-[750] leading-none tracking-[-0.02em]">{title}</h1>
          <p className="mt-[1vh] text-[2vh] font-[450] text-white/75">
            {done ? 'Look closer: every tile is someone’s photo' : 'Every photo you add becomes part of the picture'}
          </p>
        </div>
        {qr && (
          <div className="flex items-center gap-[1.2vh] rounded-[2vh] bg-white p-[1vh] pr-[2vh] text-[#2b0a4a] shadow-[0_1.5vh_4vh_rgba(20,0,40,.35)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to add your photo" className="h-[11vh] w-[11vh]" />
            <p className="text-[2.1vh] font-[700] leading-tight">Scan to add<br />your photo</p>
          </div>
        )}
      </header>

      <footer ref={footerRef} className={`pointer-events-none absolute inset-x-0 bottom-0 px-[3vw] pb-[3.2vh] transition-opacity duration-500 ${clean ? 'opacity-0' : ''}`}>
        <div className="flex items-end justify-between gap-[3vw]">
          <p className="flex items-baseline gap-[1.2vh] leading-none">
            <span className="text-[7vh] font-[800] tabular-nums tracking-[-0.03em]">{count}</span>
            <span className="text-[2.3vh] font-[500] text-white/80">{done ? 'photos, one picture' : `of ${goal} photos`}</span>
          </p>
          <p className="pb-[0.6vh] text-right text-[2.3vh] font-[500] text-white/80">
            {done ? event?.final_message || 'We did it together' : left === 1 ? '1 more photo until the big picture' : `${left} more until the big picture`}
          </p>
        </div>
        <div className="mt-[1.6vh] h-[1.1vh] overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{width: `${done ? 100 : pct}%`, background: 'linear-gradient(90deg,#00d1ff,#8a2be2 35%,#ff3d8b 70%,#ffb000)'}} />
        </div>
      </footer>

      {/* Who just joined, while their photo is flying in. */}
      <AnimatePresence>
        {flying?.name && !done && !clean && (
          <motion.div key={flying.id} initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}}
            className="pointer-events-none absolute left-1/2 top-[3.6vh] max-w-[40vw] -translate-x-1/2 truncate rounded-full bg-white px-[2.4vh] py-[1.1vh] text-[2.3vh] font-[650] text-[#2b0a4a] shadow-[0_1vh_3vh_rgba(20,0,40,.3)]">
            {flying.name} joined the picture{flying.message ? `: “${flying.message}”` : ''}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The big moment. */}
      <AnimatePresence>
        {phase === 'mosaic' && <RevealMessage text={event?.final_message || 'We did it together'} count={count} />}
      </AnimatePresence>

      {demo && !clean && <DemoControls engine={engineRef} />}

      <button type="button" onClick={() => toggleRef.current()} aria-label={clean ? 'Exit fullscreen' : 'Fullscreen'}
        className={`absolute bottom-[3vh] right-[3vw] z-10 flex items-center gap-2 rounded-full bg-black/45 px-4 py-2.5 text-[15px] font-[600] text-white backdrop-blur transition-opacity duration-300 ${idle ? 'pointer-events-none opacity-0' : 'opacity-100'} ${clean ? '' : 'mb-[9vh]'}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {clean ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
        </svg>
        {clean ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
      </button>
    </main>
  );
}

function RevealMessage({text, count}: {text: string; count: number}) {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 7000); return () => clearTimeout(t); }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, transition: {duration: 1.2}}}
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#1d0633]/35 text-center">
          <motion.p initial={{scale: 0.6, opacity: 0}} animate={{scale: 1, opacity: 1}} transition={{type: 'spring', stiffness: 120, damping: 14, delay: 0.3}}
            className="px-[4vw] text-[11vh] font-[800] leading-[0.95] tracking-[-0.03em]"
            style={{textShadow: '0 0.6vh 4vh rgba(20,0,40,.6)'}}>
            {text}
          </motion.p>
          <motion.p initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 1}} className="mt-[2.5vh] text-[3vh] font-[550] text-white/90">
            {count} photos became one picture
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Slow drifting colour glows behind everything (respects reduced motion). */
function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes drift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(8vw,6vh) scale(1.15)}}
        @keyframes drift2{0%,100%{transform:translate(0,0) scale(1.1)}50%{transform:translate(-10vw,-4vh) scale(.95)}}
        @keyframes drift3{0%,100%{transform:translate(0,0)}50%{transform:translate(4vw,-8vh)}}
        @media (prefers-reduced-motion:reduce){.glow{animation:none!important}}
      `}</style>
      <div className="glow absolute -left-[15vw] -top-[20vh] h-[80vh] w-[60vw] rounded-full opacity-80 blur-[10vh]" style={{background: '#8a0fc2', animation: 'drift1 26s ease-in-out infinite'}} />
      <div className="glow absolute -right-[10vw] top-[25vh] h-[75vh] w-[50vw] rounded-full opacity-60 blur-[12vh]" style={{background: '#ff3d8b', animation: 'drift2 31s ease-in-out infinite'}} />
      <div className="glow absolute bottom-[-30vh] left-[25vw] h-[70vh] w-[55vw] rounded-full opacity-50 blur-[12vh]" style={{background: '#00b7ff', animation: 'drift3 37s ease-in-out infinite'}} />
      <div className="glow absolute right-[20vw] top-[-25vh] h-[50vh] w-[35vw] rounded-full opacity-40 blur-[10vh]" style={{background: '#ffb000', animation: 'drift1 41s ease-in-out infinite reverse'}} />
    </div>
  );
}

// ——— Demo mode: rehearse the show with generated photos (nothing is saved) ———

const NAMES = ['Priya', 'Marcus', 'Lena', 'Tomás', 'Aisha', 'Kenji', 'Sofia', 'Omar', 'Mei', 'Jonas', 'Fatima', 'Diego', 'Anya', 'Ravi', 'Chloe', 'Sam'];

function fakePhoto(i: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 240;
  const x = c.getContext('2d')!;
  const rnd = (n: number) => Math.abs(Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
  // Mostly dark / purple scenes with some bright ones, like real event photos against this logo.
  const kind = rnd(1);
  const hue = kind < 0.45 ? 260 + rnd(2) * 60 : kind < 0.8 ? rnd(3) * 360 : 40 + rnd(4) * 30;
  const light = kind < 0.45 ? 8 + rnd(5) * 18 : kind < 0.8 ? 30 + rnd(6) * 30 : 70 + rnd(7) * 25;
  const g = x.createLinearGradient(0, 0, 240, 240);
  g.addColorStop(0, `hsl(${hue} 70% ${light + 8}%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 65% ${Math.max(4, light - 8)}%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 240, 240);
  for (let k = 0; k < 6; k++) {
    x.fillStyle = `hsla(${(hue + rnd(10 + k) * 120) % 360} 80% ${Math.min(95, light + 25)}% / .35)`;
    x.beginPath(); x.arc(rnd(20 + k) * 240, rnd(30 + k) * 240, 10 + rnd(40 + k) * 40, 0, Math.PI * 2); x.fill();
  }
  // A simple person silhouette.
  x.fillStyle = `hsl(${(hue + 180) % 360} 35% ${Math.min(92, light + 35)}%)`;
  x.beginPath(); x.arc(120, 95, 38, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(120, 230, 78, 70, 0, Math.PI, 0); x.fill();
  return c.toDataURL('image/jpeg', 0.85);
}

function DemoControls({engine}: {engine: React.RefObject<WallEngine | null>}) {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const list = useRef<WallPhoto[]>([]);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      const i = list.current.length;
      list.current = [...list.current, {id: `demo-${i}`, thumb: fakePhoto(i), name: i % 3 === 0 ? NAMES[i % NAMES.length] : null}];
      engine.current?.sync(list.current, true);
    }, Math.max(90, 1400 / speed));
    return () => clearInterval(iv);
  }, [running, speed, engine]);
  useEffect(() => { engine.current?.setSpeed(speed); }, [speed, engine]);
  const add = (n: number) => {
    for (let k = 0; k < n; k++) { const i = list.current.length; list.current = [...list.current, {id: `demo-${i}`, thumb: fakePhoto(i)}]; }
    engine.current?.sync(list.current, false);
  };
  return (
    <div className="absolute left-1/2 top-[3.2vh] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 p-1.5 text-sm font-[600] text-[#2b0a4a] shadow-lg">
      <button type="button" onClick={() => setRunning((r) => !r)} className="rounded-full bg-[#8a0fc2] px-4 py-2 text-white">{running ? 'Pause' : 'Start demo'}</button>
      {[1, 3, 8].map((s) => (
        <button key={s} type="button" onClick={() => setSpeed(s)} className={`rounded-full px-3 py-2 ${speed === s ? 'bg-[#2b0a4a] text-white' : ''}`}>{s}×</button>
      ))}
      <button type="button" onClick={() => add(10)} className="rounded-full px-3 py-2">+10 instantly</button>
      <button type="button" onClick={() => engine.current?.reveal()} className="rounded-full px-3 py-2">Reveal now</button>
    </div>
  );
}
