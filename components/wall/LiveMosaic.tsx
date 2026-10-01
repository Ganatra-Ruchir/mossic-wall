'use client';
import '@fontsource-variable/bricolage-grotesque';
import {AnimatePresence, motion} from 'framer-motion';
import QRCode from 'qrcode';
import {useCallback, useEffect, useRef, useState} from 'react';
import {normalizeDesign, type Design} from '@/lib/design';
import type {WallData} from '@/lib/types';
import {WallEngine, type WallPhoto} from './WallEngine';

const DEFAULT_TARGET = '/targets/micron.jpg';
const FONT = '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif';

type Props = {eventId: string; initial?: WallData; demo?: boolean; preview?: boolean};

export default function LiveMosaic({eventId, initial, demo = false, preview = false}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WallEngine | null>(null);
  const placeRef = useRef<() => void>(() => {});
  const [data, setData] = useState<WallData | undefined>(initial);
  const wallSignature = useRef(initial ? JSON.stringify(initial) : '');
  const refreshing = useRef(false);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<'gallery' | 'revealing' | 'mosaic'>('gallery');
  const [flying, setFlying] = useState<WallPhoto | null>(null);
  const [spot, setSpot] = useState<WallPhoto | null>(null);
  const [cta, setCta] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastArrival = useRef(Date.now());
  const [milestone, setMilestone] = useState<{key: number; title: string; text: string} | null>(null);
  const [qr, setQr] = useState('');
  const [clean, setClean] = useState(false); // fullscreen: only the mosaic
  const [idle, setIdle] = useState(false);   // hide the cursor and button when the mouse rests
  const cleanRef = useRef(false);
  const event = data?.event;
  const goal = Math.max(2, Math.min(event?.goal ?? 150, event?.total_slots ?? 150));
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const title = previewTitle ?? (demo ? 'Micron' : event?.name ?? '');
  // Design from Admin → Design; the admin editor's live preview overrides it via postMessage.
  const [override, setOverride] = useState<Design | null>(null);
  const design = override ?? normalizeDesign(event?.design, {fly_from: event?.fly_from, animation_speed: event?.animation_speed});

  // Engine lifecycle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const e = new WallEngine(canvas, goal, {onCount: setCount, onPhase: setPhase, onFlight: setFlying, onSpotlight: setSpot}, Number(event?.animation_speed) || 1);
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
  const designKey = JSON.stringify(design);
  useEffect(() => { engineRef.current?.setDesign(design); }, [designKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Play reveal now" in admin bumps reveal_token; walls already open play it on their next poll.
  const seenToken = useRef(initial?.event.reveal_token ?? 0);
  useEffect(() => {
    const t = event?.reveal_token ?? 0;
    if (t > seenToken.current) { seenToken.current = t; engineRef.current?.reveal(); }
  }, [event?.reveal_token]);

  // "Show me on the big screen" from a guest's phone: a new spotlight request since we loaded.
  const seenSpot = useRef(initial?.event.spotlight_at ?? null);
  useEffect(() => {
    const at = event?.spotlight_at ?? null, id = event?.spotlight_id;
    if (!at || at === seenSpot.current || !id) return;
    seenSpot.current = at;
    engineRef.current?.spotlight(id);
  }, [event?.spotlight_at, event?.spotlight_id]);

  // "Join us" reminder: after a minute without new photos, a big QR card for 8 s (then again a minute later).
  useEffect(() => { lastArrival.current = Date.now(); setCta(false); }, [count]);
  useEffect(() => {
    if (!design.callToAction || phase !== 'gallery' || clean) { setCta(false); return; }
    const iv = setInterval(() => {
      if (Date.now() - lastArrival.current > 60000) {
        setCta(true);
        lastArrival.current = Date.now(); // next reminder a minute later
        setTimeout(() => setCta(false), 8000);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [design.callToAction, phase, clean]);

  // Save the finished picture as a high-resolution image (button after the reveal, or the S key).
  const savePicture = useCallback(async () => {
    const e = engineRef.current;
    if (!e || saving) return;
    setSaving(true);
    try {
      const g = e.gridSize();
      const blob = await e.exportImage(Math.max(128, Math.ceil(3840 / Math.max(1, g.cols))));
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(title || 'mosaic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mosaic'}-picture.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } finally { setSaving(false); }
  }, [saving, title]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === 's' || e.key === 'S') && !(e.target instanceof HTMLInputElement) && !e.metaKey && !e.ctrlKey) savePicture(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [savePicture]);

  // Milestones: banner + confetti when the wall passes 25 %, 50 % and 75 % of the goal (not on page load).
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { if (lastCount.current === null) lastCount.current = count; }, 2500);
    return () => clearTimeout(t);
  }, [count]);
  useEffect(() => {
    const prev = lastCount.current;
    if (prev === null) return;
    lastCount.current = count;
    if (!design.milestones || phase !== 'gallery' || count <= prev) return;
    const hit = [0.75, 0.5, 0.25].find((f) => prev < Math.ceil(goal * f) && count >= Math.ceil(goal * f));
    if (!hit) return;
    const left = Math.max(0, goal - count);
    setMilestone({key: Date.now(), title: hit === 0.5 ? 'Halfway there!' : hit === 0.25 ? 'A quarter of the way!' : 'Almost there!', text: `${left} more photo${left === 1 ? '' : 's'} until the big picture`});
    engineRef.current?.celebrate();
    const t = setTimeout(() => setMilestone(null), 4500);
    return () => clearTimeout(t);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview mode (inside the admin Design editor): settings and reveal arrive by postMessage.
  useEffect(() => {
    if (!preview) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'mosaic-design') {
        setOverride(normalizeDesign(e.data.design));
        if (typeof e.data.title === 'string') setPreviewTitle(e.data.title);
        if (typeof e.data.target === 'string' && e.data.target) engineRef.current?.setTarget(e.data.target);
      }
      if (e.data?.type === 'mosaic-reveal') engineRef.current?.reveal();
    };
    window.addEventListener('message', onMsg);
    window.parent?.postMessage({type: 'mosaic-preview-ready'}, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, [preview]);

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
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await fetch(`/api/wall/${eventId}`, {cache: 'no-store'});
      if (r.ok) {
        const next = await r.json() as WallData;
        const signature = JSON.stringify(next);
        if (signature !== wallSignature.current) {
          wallSignature.current = signature;
          setData(next);
        }
      }
    } catch { /* keep showing what we have; next poll retries */ }
    finally { refreshing.current = false; }
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
    <main className="fixed inset-0 overflow-hidden text-white" style={{fontFamily: FONT, background: design.background, cursor: idle ? 'none' : undefined}}>
      {design.glows && <Backdrop strength={design.glowStrength / 100} />}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <header ref={headerRef} className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-[3vw] pt-[3.2vh] transition-opacity duration-500 ${clean ? 'opacity-0' : ''}`}>
        <div className={design.showTitle ? '' : 'invisible'}>
          <h1 className="text-[4.2vh] font-[750] leading-none tracking-[-0.02em]">{title}</h1>
          <p className="mt-[1vh] text-[2vh] font-[450] text-white/75">
            {design.tagline || (done ? 'Look closer: every tile is someone’s photo' : 'Every photo you add becomes part of the picture')}
          </p>
        </div>
        {qr && design.showQr && (
          <div className="flex items-center gap-[1.2vh] rounded-[2vh] bg-white p-[1vh] pr-[2vh] text-[#2b0a4a] shadow-[0_1.5vh_4vh_rgba(20,0,40,.35)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to add your photo" className="h-[11vh] w-[11vh]" />
            <p className="text-[2.1vh] font-[700] leading-tight">Scan to add<br />your photo</p>
          </div>
        )}
      </header>

      <footer ref={footerRef} className={`pointer-events-none absolute inset-x-0 bottom-0 px-[3vw] pb-[3.2vh] transition-opacity duration-500 ${clean || !design.showCounter ? 'opacity-0' : ''}`}>
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
            style={{width: `${done ? 100 : pct}%`, background: `linear-gradient(90deg,#00d1ff,${design.accent} 55%,#ffb000)`}} />
        </div>
      </footer>

      {/* Who just joined, while their photo is flying in. */}
      <AnimatePresence>
        {flying?.name && !done && !clean && design.showCaptions && (
          <motion.div key={flying.id} initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -10}}
            className="pointer-events-none absolute left-1/2 top-[3.6vh] max-w-[40vw] -translate-x-1/2 truncate rounded-full bg-white px-[2.4vh] py-[1.1vh] text-[2.3vh] font-[650] text-[#2b0a4a] shadow-[0_1vh_3vh_rgba(20,0,40,.3)]">
            {flying.name} joined the picture{flying.message ? `: “${flying.message}”` : ''}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spotlight caption: who this photo is from. */}
      <AnimatePresence>
        {spot && (spot.name || spot.message) && (
          <motion.div key={spot.id} initial={{opacity: 0, y: 14}} animate={{opacity: 1, y: 0, transition: {delay: 0.45}}} exit={{opacity: 0}}
            className="pointer-events-none absolute inset-x-0 top-[76vh] text-center" style={{textShadow: "0 0.4vh 2vh rgba(0,0,0,.8)"}}>
            {spot.name && <p className="text-[4.4vh] font-[800] leading-none">{spot.name}</p>}
            {spot.message && <p className="mx-auto mt-[1.2vh] max-w-[60vw] text-[2.6vh] font-[500] text-white/85">“{spot.message}”</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Join us" reminder when the wall has been quiet for a minute. */}
      <AnimatePresence>
        {cta && qr && !clean && !spot && (
          <motion.div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}>
            <motion.div initial={{scale: 0.85, y: 20}} animate={{scale: 1, y: 0}} exit={{scale: 0.95}} transition={{type: 'spring', stiffness: 180, damping: 16}}
              className="flex items-center gap-[4vh] rounded-[4vh] bg-white p-[3.5vh] pr-[6vh] text-[#2b0a4a] shadow-[0_3vh_8vh_rgba(0,0,0,.5)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code to add your photo" className="h-[32vh] w-[32vh]" />
              <div className="max-w-[34vw]">
                <p className="text-[6.5vh] font-[800] leading-[1.02] tracking-[-0.02em]">Be part of the picture</p>
                <p className="mt-[2vh] text-[3vh] font-[550] text-[#2b0a4a]/80">Scan with your phone camera and add your photo. {left > 0 ? `${left} more until the big reveal!` : ''}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Milestone banner. */}
      <AnimatePresence>
        {milestone && !clean && (
          <motion.div key={milestone.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}>
            {/* Centred by the flex parent: the spring scale animation would override a translate-based centre. */}
            <motion.div initial={{scale: 0.8}} animate={{scale: 1}} exit={{scale: 0.95}} transition={{type: 'spring', stiffness: 200, damping: 16}}
              className="rounded-[3vh] px-[5vh] py-[3vh] text-center shadow-[0_2vh_6vh_rgba(0,0,0,.45)]"
              style={{background: `linear-gradient(135deg, ${design.accent}, #8a2be2)`}}>
              <p className="text-[7vh] font-[800] leading-none tracking-[-0.02em]">{milestone.title}</p>
              <p className="mt-[1.4vh] text-[2.8vh] font-[600] text-white/90">{milestone.text}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The big moment. */}
      <AnimatePresence>
        {phase === 'mosaic' && <RevealMessage text={event?.final_message || 'We did it together'} count={count} />}
      </AnimatePresence>

      {demo && !clean && !preview && <DemoControls engine={engineRef} />}
      {preview && <PreviewFeeder engine={engineRef} />}

      {done && !preview && (
        <button type="button" onClick={savePicture} disabled={saving}
          className={`absolute bottom-[3vh] right-[3vw] z-10 flex items-center gap-2 rounded-full bg-black/45 px-4 py-2.5 text-[15px] font-[600] text-white backdrop-blur transition-opacity duration-300 ${idle ? 'pointer-events-none opacity-0' : 'opacity-100'} ${clean ? 'mr-[16vw]' : 'mb-[9vh] mr-[16vw]'}`}>
          {saving ? 'Saving…' : 'Save picture (S)'}
        </button>
      )}
      {!preview && <button type="button" onClick={() => toggleRef.current()} aria-label={clean ? 'Exit fullscreen' : 'Fullscreen'}
        className={`absolute bottom-[3vh] right-[3vw] z-10 flex items-center gap-2 rounded-full bg-black/45 px-4 py-2.5 text-[15px] font-[600] text-white backdrop-blur transition-opacity duration-300 ${idle ? 'pointer-events-none opacity-0' : 'opacity-100'} ${clean ? '' : 'mb-[9vh]'}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {clean ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
        </svg>
        {clean ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
      </button>}
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
function Backdrop({strength = 0.7}: {strength?: number}) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" style={{opacity: Math.min(1, strength / 0.7)}}>
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

/** Preview inside the admin Design editor: a wall with sample photos and a slow stream of arrivals. */
function PreviewFeeder({engine}: {engine: React.RefObject<WallEngine | null>}) {
  const list = useRef<WallPhoto[]>([]);
  useEffect(() => {
    const add = (n: number, animate: boolean) => {
      for (let k = 0; k < n; k++) { const i = list.current.length; list.current = [...list.current, {id: `pv-${i}`, thumb: fakePhoto(i), name: i % 2 ? NAMES[i % NAMES.length] : null, message: i % 4 === 1 ? 'Hello!' : null}]; }
      engine.current?.sync(list.current, animate);
    };
    const t0 = setTimeout(() => add(18, false), 300);
    const iv = setInterval(() => { if (list.current.length < 60) add(1, true); }, 3500);
    return () => { clearTimeout(t0); clearInterval(iv); };
  }, [engine]);
  return null;
}
