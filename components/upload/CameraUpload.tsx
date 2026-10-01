'use client';
import '@fontsource-variable/bricolage-grotesque';
import {AnimatePresence, motion} from 'framer-motion';
import {useCallback, useEffect, useRef, useState} from 'react';
import {looksLikeImage, shrinkImage} from '@/lib/image-client';

// Camera-first guest screen: opens on a live viewfinder. Shutter → review → add to the mosaic.
// Bottom-left opens the gallery (several photos at once); bottom-right flips the camera.

const FONT = '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif';
const MAX_BATCH = 20;
const NAME_KEY = 'mosaic_guest_name';
// Photo looks: CSS filters for the preview, the same filter applied to the canvas before sending.
const LOOKS = [
  {id: 'original', label: 'Original', css: 'none'},
  {id: 'vivid', label: 'Vivid', css: 'saturate(1.5) contrast(1.08)'},
  {id: 'warm', label: 'Warm', css: 'sepia(0.3) saturate(1.35) hue-rotate(-8deg) brightness(1.04)'},
  {id: 'mono', label: 'Mono', css: 'grayscale(1) contrast(1.15)'},
] as const;
type Look = (typeof LOOKS)[number]['id'];
const canvasFilters = () => typeof document !== 'undefined' && 'filter' in (document.createElement('canvas').getContext('2d') ?? {});

/** Re-encode the shot with the chosen look. */
async function applyLook(blob: Blob, look: Look): Promise<Blob> {
  const css = LOOKS.find((l) => l.id === look)?.css ?? 'none';
  if (css === 'none' || !canvasFilters()) return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d')!;
  x.filter = css;
  x.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((res) => c.toBlob((b) => res(b ?? blob), 'image/jpeg', 0.9));
}

type Result = 'approved' | 'pending' | 'waiting' | 'demo';
type Item = {id: string; file: File; url: string; state: 'waiting' | 'sending' | 'done' | 'error'; error?: string; progress: number};
type View =
  | {kind: 'camera'}
  | {kind: 'shot'; blob: Blob; url: string}
  | {kind: 'batch'}
  | {kind: 'done'; count: number; failed: number; result: Result; url?: string; spotId?: string; number?: number; goal?: number};

type Sent = {result: Result; id?: string; deleteToken?: string; thumbnailUrl?: string; count?: number; goal?: number};
type Mine = {id: string; token: string; thumb: string; at: number};

/** Upload one photo with progress. */
function send(blob: Blob, eventId: string, name: string, message: string, onProgress: (p: number) => void): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    fd.append('eventId', eventId);
    if (name.trim()) fd.append('name', name.trim());
    if (message.trim()) fd.append('message', message.trim());
    const x = new XMLHttpRequest();
    x.open('POST', '/api/upload');
    x.responseType = 'json';
    x.timeout = 60000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      const j = (x.response ?? {}) as {status?: string; error?: string; id?: string; deleteToken?: string; thumbnailUrl?: string; count?: number; goal?: number};
      if (x.status >= 200 && x.status < 300) resolve({result: j.status === 'pending' || j.status === 'waiting' || j.status === 'demo' ? j.status : 'approved', id: j.id, deleteToken: j.deleteToken, thumbnailUrl: j.thumbnailUrl, count: j.count, goal: j.goal});
      else reject(new Error(j.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('No connection. Check your signal and try again.'));
    x.ontimeout = () => reject(new Error('The upload took too long. Try again.'));
    x.send(fd);
  });
}

export default function CameraUpload({eventId, eventName, theme}: {eventId: string; eventName?: string; theme?: {background: string; accent: string}}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const nativeCamRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied' | 'unavailable'>('starting');
  const [view, setView] = useState<View>({kind: 'camera'});
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [look, setLook] = useState<Look>('original');
  const [prog, setProg] = useState<{count: number; goal: number} | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [showMine, setShowMine] = useState(false);
  const mineKey = `mosaic_mine_${eventId}`;

  // My photos on this phone (ids + private remove keys), kept in this browser only.
  useEffect(() => { try { setMine(JSON.parse(localStorage.getItem(mineKey) || '[]')); } catch { /* ignore */ } }, [mineKey]);
  const saveMine = (list: Mine[]) => { setMine(list); try { localStorage.setItem(mineKey, JSON.stringify(list.slice(-50))); } catch { /* ignore */ } };
  const remember = (r: Sent) => { if (r.id && r.deleteToken) saveMine([...mineRef.current, {id: r.id, token: r.deleteToken, thumb: r.thumbnailUrl || '', at: Date.now()}]); };
  const mineRef = useRef<Mine[]>([]);
  useEffect(() => { mineRef.current = mine; }, [mine]);

  // Live progress: "37 of 150 photos".
  useEffect(() => {
    if (eventId === 'demo') return;
    const get = () => fetch(`/api/progress?event=${eventId}`, {cache: 'no-store'}).then((r) => (r.ok ? r.json() : null)).then((j) => j && setProg({count: j.count, goal: j.goal})).catch(() => {});
    get();
    const iv = setInterval(get, 15000);
    return () => clearInterval(iv);
  }, [eventId]);

  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? ''); } catch { /* private mode */ } }, []);
  const rememberName = (n: string) => { setName(n); try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } };

  // ——— camera ———
  const stop = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);
  useEffect(() => {
    if (view.kind !== 'camera') return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: facing}, width: {ideal: 1920}, height: {ideal: 1920}}, audio: false});
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
        setCamera('on');
      } catch (e) {
        setCamera((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [facing, view.kind, stop]);

  /** Shutter: straight away, or after a 3 / 10 s countdown (tap again to cancel). */
  function press() {
    if (countdown !== null) { if (countRef.current) clearInterval(countRef.current); countRef.current = null; setCountdown(null); return; }
    if (!timer) { shoot(); return; }
    let n = timer;
    setCountdown(n);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { if (countRef.current) clearInterval(countRef.current); countRef.current = null; setCountdown(null); shoot(); }
      else setCountdown(n);
    }, 1000);
  }
  useEffect(() => () => { if (countRef.current) clearInterval(countRef.current); }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const out = Math.min(1600, side);
    const c = document.createElement('canvas');
    c.width = c.height = out;
    const ctx = c.getContext('2d')!;
    if (facing === 'user') { ctx.translate(out, 0); ctx.scale(-1, 1); } // save selfies as seen
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    c.toBlob((b) => { if (b) { stop(); setError(''); setLook('original'); setView({kind: 'shot', blob: b, url: URL.createObjectURL(b)}); } }, 'image/jpeg', 0.9);
  }

  // ——— gallery (several at once) ———
  function picked(list: FileList | null) {
    setError('');
    if (!list?.length) return;
    const files = [...list].filter(looksLikeImage);
    if (!files.length) { setError('Those files aren’t photos. Choose JPG, PNG, HEIC or WEBP images.'); return; }
    const chosen = files.slice(0, MAX_BATCH);
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems(chosen.map((file, k) => ({id: `${Date.now()}-${k}`, file, url: URL.createObjectURL(file), state: 'waiting', progress: 0})));
    if (files.length > MAX_BATCH) setError(`Up to ${MAX_BATCH} photos at a time. The first ${MAX_BATCH} are ready to send.`);
    stop();
    setView({kind: 'batch'});
  }

  async function sendShot(v: Extract<View, {kind: 'shot'}>) {
    setBusy(true); setError(''); setProgress(0);
    try {
      const finalBlob = await applyLook(v.blob, look);
      const r = await send(finalBlob, eventId, name, message, setProgress);
      remember(r);
      if (r.count !== undefined && r.goal) setProg({count: r.count, goal: r.goal});
      setMessage('');
      setView({kind: 'done', count: 1, failed: 0, result: r.result, url: v.url, spotId: r.result === 'approved' ? r.id : undefined, number: r.result === 'approved' ? r.count : undefined, goal: r.goal});
      navigator.vibrate?.(20);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  async function sendBatch() {
    setBusy(true); setError('');
    let ok = 0, failed = 0, last: Result = 'approved', firstOnWall: Sent | null = null, latest: Sent | null = null;
    for (const it of items) {
      if (it.state === 'done') { ok++; continue; }
      setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'sending', progress: 0, error: undefined} : x)));
      try {
        const blob = await shrinkImage(it.file);
        const r = await send(blob, eventId, name, message, (p) => setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, progress: p} : x))));
        last = r.result; latest = r; remember(r);
        if (r.result === 'approved' && !firstOnWall) firstOnWall = r;
        ok++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'done', progress: 1} : x)));
      } catch (e) {
        failed++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'error', error: e instanceof Error ? e.message : 'Failed'} : x)));
      }
    }
    setBusy(false);
    const lr = latest as Sent | null;
    if (lr?.count !== undefined && lr.goal) setProg({count: lr.count, goal: lr.goal});
    if (failed === 0) { setMessage(''); setView({kind: 'done', count: ok, failed, result: last, url: items[0]?.url, spotId: (firstOnWall as Sent | null)?.id, goal: lr?.goal}); navigator.vibrate?.(20); }
    else setError(failed === items.length ? 'None of the photos went through. Check your connection and tap Retry.' : `${ok} sent, ${failed} didn’t go through. Tap Retry to try those again.`);
  }

  async function saveToPhone(blob: Blob) {
    const file = new File([blob], 'my-mosaic-photo.jpg', {type: 'image/jpeg'});
    const nav = navigator as Navigator & {canShare?: (d: ShareData) => boolean};
    // The share sheet on phones offers "Save image"; elsewhere, download the file.
    if (nav.canShare?.({files: [file]})) { try { await nav.share({files: [file]}); return; } catch { /* cancelled */ return; } }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-mosaic-photo.jpg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function backToCamera() {
    if (view.kind === 'shot' || view.kind === 'done') { if (view.url) URL.revokeObjectURL(view.url); }
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]); setError(''); setProgress(0);
    setCamera('starting');
    setView({kind: 'camera'});
  }

  const lastThumb = items[0]?.url;

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-black text-white" style={{fontFamily: FONT, ['--bg' as string]: theme?.background ?? '#1d0633', ['--accent' as string]: theme?.accent ?? '#ff3d8b'}}>
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />
      <input ref={nativeCamRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />

      {/* ——— Camera ——— */}
      {view.kind === 'camera' && (
        <div className="absolute inset-0">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{transform: facing === 'user' ? 'scaleX(-1)' : undefined}} />
          {camera === 'on' && <SquareGuide />}
          {(camera === 'denied' || camera === 'unavailable') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg)] px-8 text-center">
              <h2 className="text-[28px] font-[750] leading-tight">{camera === 'denied' ? 'Camera access is off' : 'Camera isn’t available here'}</h2>
              <p className="mt-3 max-w-xs text-[15px] text-white/75">
                {camera === 'denied' ? 'Allow camera access for this site in your browser settings, or use the buttons below.' : 'You can still take a photo with your phone’s camera or pick some from your gallery.'}
              </p>
              <button type="button" onClick={() => nativeCamRef.current?.click()} className="mt-8 w-full max-w-xs rounded-full bg-white py-4 text-[17px] font-[700] text-[#2b0a4a]">Take a photo</button>
              <button type="button" onClick={() => galleryRef.current?.click()} className="mt-3 w-full max-w-xs rounded-full border border-white/40 py-4 text-[17px] font-[650]">Choose from gallery</button>
            </div>
          )}
          <TopBar eventName={eventName} prog={prog} mineCount={mine.length} onMine={() => setShowMine(true)} />
          {camera !== 'denied' && camera !== 'unavailable' && (
            <>
            {countdown !== null && (
              <motion.p key={countdown} initial={{scale: 1.6, opacity: 0}} animate={{scale: 1, opacity: 1}} className="pointer-events-none absolute inset-0 grid place-items-center text-[140px] font-[800] text-white" style={{textShadow: '0 6px 30px rgba(0,0,0,.6)'}}>{countdown}</motion.p>
            )}
            <button type="button" onClick={() => setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))} aria-label="Selfie timer"
              className="absolute bottom-[calc(max(28px,env(safe-area-inset-bottom))+104px)] left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-[13px] font-[650] backdrop-blur">
              ⏱ {timer ? `Timer ${timer}s` : 'Timer off'}
            </button>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-[max(28px,env(safe-area-inset-bottom))] pt-6" style={{background: 'linear-gradient(transparent, rgba(0,0,0,.55))'}}>
              <button type="button" aria-label="Choose photos from your gallery" onClick={() => galleryRef.current?.click()}
                className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border-2 border-white/90 bg-white/15 backdrop-blur">
                {lastThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lastThumb} alt="" className="h-full w-full object-cover" />
                ) : <GalleryIcon />}
              </button>
              <button type="button" aria-label={countdown !== null ? 'Cancel timer' : 'Take photo'} onClick={press} disabled={camera !== 'on'}
                className="grid h-[84px] w-[84px] place-items-center rounded-full border-[5px] border-white disabled:opacity-40">
                <span className="h-[64px] w-[64px] rounded-full bg-white transition active:scale-90" />
              </button>
              <button type="button" aria-label="Switch camera" onClick={() => { setCamera('starting'); setFacing((f) => (f === 'user' ? 'environment' : 'user')); }}
                className="grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur">
                <FlipIcon />
              </button>
            </div>
            </>
          )}
          {camera === 'starting' && <p className="absolute inset-x-0 top-1/2 text-center text-white/70">Starting camera…</p>}
          <AnimatePresence>{flash && <motion.div initial={{opacity: 0.9}} animate={{opacity: 0}} exit={{opacity: 0}} className="absolute inset-0 bg-white" />}</AnimatePresence>
          {error && <Toast text={error} onClose={() => setError('')} />}
        </div>
      )}

      {/* ——— Review a camera shot ——— */}
      {view.kind === 'shot' && (
        <Sheet eventName={eventName}>
          <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[22px] shadow-[0_18px_50px_rgba(0,0,0,.5)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.url} alt="Your photo" className="aspect-square w-full object-cover" style={{filter: LOOKS.find((l) => l.id === look)?.css}} />
          </div>
          {canvasFilters() && (
            <div role="radiogroup" aria-label="Photo look" className="mt-4 grid grid-cols-4 gap-2">
              {LOOKS.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={look === l.id} onClick={() => setLook(l.id)} disabled={busy}
                  className={`overflow-hidden rounded-xl border-2 ${look === l.id ? 'border-white' : 'border-transparent opacity-80'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={view.url} alt="" className="aspect-square w-full object-cover" style={{filter: l.css}} />
                  <span className="block bg-black/40 py-1 text-[12px] font-[650]">{l.label}</span>
                </button>
              ))}
            </div>
          )}
          <Fields name={name} setName={rememberName} message={message} setMessage={setMessage} disabled={busy} />
          {error && <p role="alert" className="mt-3 rounded-2xl bg-[#ff3d8b]/20 px-4 py-3 text-[14px] text-[#ffd1e3]">{error}</p>}
          <PrimaryButton onClick={() => sendShot(view)} busy={busy} progress={progress} label="Add to the mosaic" />
          <Consent />
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={backToCamera} disabled={busy} className="flex-1 rounded-full border border-white/35 py-3.5 text-[16px] font-[650]">Retake</button>
            <button type="button" onClick={() => saveToPhone(view.blob)} disabled={busy} className="flex-1 rounded-full border border-white/35 py-3.5 text-[16px] font-[650]">Save to my phone</button>
          </div>
        </Sheet>
      )}

      {/* ——— Review several gallery photos ——— */}
      {view.kind === 'batch' && (
        <Sheet eventName={eventName}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[24px] font-[750]">{items.length === 1 ? '1 photo' : `${items.length} photos`}</h2>
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={busy} className="text-[15px] font-[650] text-[#ffb3d6]">Choose again</button>
          </div>
          <ul className="mt-4 grid grid-cols-3 gap-2">
            {items.map((it) => (
              <li key={it.id} className="relative aspect-square overflow-hidden rounded-2xl bg-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt="" className={`h-full w-full object-cover transition ${it.state === 'done' ? 'opacity-60' : ''}`} />
                {it.state === 'waiting' && !busy && (
                  <button type="button" aria-label="Remove this photo" onClick={() => { URL.revokeObjectURL(it.url); setItems((xs) => xs.filter((x) => x.id !== it.id)); }}
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-[16px] leading-none">×</button>
                )}
                {it.state === 'sending' && <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/40"><div className="h-full bg-white transition-[width]" style={{width: `${Math.round(it.progress * 100)}%`}} /></div>}
                {it.state === 'done' && <span className="absolute inset-0 grid place-items-center text-[30px]">✓</span>}
                {it.state === 'error' && <span title={it.error} className="absolute inset-x-1 bottom-1 rounded-lg bg-[#ff3d8b] px-1.5 py-0.5 text-center text-[11px] font-[650]">Didn’t send</span>}
              </li>
            ))}
          </ul>
          <Fields name={name} setName={rememberName} message={message} setMessage={setMessage} disabled={busy} />
          {error && <p role="alert" className="mt-3 rounded-2xl bg-[#ff3d8b]/20 px-4 py-3 text-[14px] text-[#ffd1e3]">{error}</p>}
          <PrimaryButton onClick={sendBatch} busy={busy} disabled={!items.length}
            label={items.some((i) => i.state === 'error') ? 'Retry' : items.length === 1 ? 'Add 1 photo to the mosaic' : `Add ${items.length} photos to the mosaic`}
            progress={items.length ? items.filter((i) => i.state === 'done').length / items.length : 0} />
          <Consent />
          <button type="button" onClick={backToCamera} disabled={busy} className="mt-3 w-full rounded-full border border-white/35 py-3.5 text-[16px] font-[650]">Back to camera</button>
        </Sheet>
      )}

      {/* ——— Sent ——— */}
      {view.kind === 'done' && <Done view={view} onAgain={backToCamera} eventId={eventId} eventName={eventName} />}
      {showMine && <MyPhotos mine={mine} onClose={() => setShowMine(false)} onRemoved={(id) => saveMine(mine.filter((m) => m.id !== id))} />}
    </main>
  );
}

function TopBar({eventName, prog, mineCount, onMine}: {eventName?: string; prog: {count: number; goal: number} | null; mineCount: number; onMine: () => void}) {
  const pct = prog ? Math.min(100, (prog.count / Math.max(1, prog.goal)) * 100) : 0;
  return (
    <div className="absolute inset-x-0 top-0 px-5 pb-8 pt-[max(18px,env(safe-area-inset-top))]" style={{background: 'linear-gradient(rgba(0,0,0,.6), transparent)'}}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-[650] text-white/85">{eventName || 'Digital Mosaic Wall'}</p>
          <p className="mt-0.5 text-[22px] font-[750] leading-tight">Add your photo to the big picture</p>
        </div>
        {mineCount > 0 && (
          <button type="button" onClick={onMine} className="shrink-0 rounded-full bg-white/20 px-3.5 py-2 text-[13px] font-[650] backdrop-blur">My photos ({mineCount})</button>
        )}
      </div>
      {prog && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full" style={{width: `${pct}%`, background: 'var(--accent)'}} /></div>
          <p className="shrink-0 text-[13px] font-[650] text-white/90">{prog.count >= prog.goal ? `${prog.count} photos, picture complete!` : `${prog.count} of ${prog.goal} photos`}</p>
        </div>
      )}
    </div>
  );
}

/** Mosaic tiles are square: show what will be kept. */
function SquareGuide() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="aspect-square w-[88vw] max-w-[min(88vw,70vh)] rounded-[26px] shadow-[0_0_0_200vmax_rgba(0,0,0,.35)] ring-2 ring-white/80" />
    </div>
  );
}

function Sheet({children, eventName}: {children: React.ReactNode; eventName?: string}) {
  return (
    <div className="absolute inset-0 overflow-y-auto" style={{background: 'radial-gradient(120% 70% at 0% 0%, #8a0fc2 0%, transparent 60%), radial-gradient(90% 60% at 100% 100%, var(--accent) 0%, transparent 60%), var(--bg)'}}>
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <p className="mb-4 text-[15px] font-[650] text-white/80">{eventName || 'Digital Mosaic Wall'}</p>
        {children}
      </div>
    </div>
  );
}

function Fields({name, setName, message, setMessage, disabled}: {name: string; setName: (v: string) => void; message: string; setMessage: (v: string) => void; disabled: boolean}) {
  const cls = 'w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3.5 text-[16px] text-white placeholder:text-white/55 outline-none focus:border-white/70';
  return (
    <div className="mt-5 space-y-2.5">
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={disabled} placeholder="Your name (optional)" autoComplete="given-name" className={cls} />
      <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={140} disabled={disabled} placeholder="A short message (optional)" className={cls} />
    </div>
  );
}

function PrimaryButton({onClick, busy, label, progress, disabled}: {onClick: () => void; busy: boolean; label: string; progress: number; disabled?: boolean}) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled}
      className="relative mt-5 w-full overflow-hidden rounded-full py-4 text-[17px] font-[750] text-white shadow-[0_10px_30px_rgba(0,0,0,.35)] disabled:opacity-70"
      style={{background: 'linear-gradient(90deg,#8a2be2,var(--accent))'}}>
      {busy && <span className="absolute inset-y-0 left-0 bg-white/25 transition-[width]" style={{width: `${Math.round(progress * 100)}%`}} />}
      <span className="relative">{busy ? 'Sending…' : label}</span>
    </button>
  );
}

function Done({view, onAgain, eventId, eventName}: {view: Extract<View, {kind: 'done'}>; onAgain: () => void; eventId: string; eventName?: string}) {
  const title = view.result === 'demo' ? 'Demo mode: not saved'
    : view.result === 'pending' ? (view.count > 1 ? `${view.count} photos sent!` : 'Photo sent!')
    : view.count > 1 ? `${view.count} photos are on the wall!` : 'You’re on the wall!';
  const text = view.result === 'pending' ? 'They’ll appear on the big screen as soon as the host approves them.'
    : view.result === 'waiting' ? 'Every spot is taken right now. Your photo joins as soon as one frees up.'
    : view.result === 'demo' ? 'This site isn’t connected to a database yet.'
    : view.count > 1 ? 'Look at the big screen: your photos are flying into the mosaic.' : 'Look at the big screen: your photo is flying into the mosaic.';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center" style={{background: 'radial-gradient(100% 60% at 50% 30%, #8a0fc2 0%, var(--bg) 70%)'}}>
      <motion.div initial={{scale: 0.3, rotate: -12, opacity: 0}} animate={{scale: 1, rotate: -4, opacity: 1}} transition={{type: 'spring', stiffness: 180, damping: 14}}
        className="h-40 w-40 overflow-hidden rounded-[22px] border-[6px] border-white shadow-[0_20px_50px_rgba(0,0,0,.45)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {view.url && <img src={view.url} alt="" className="h-full w-full object-cover" />}
      </motion.div>
      <motion.h2 initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 0.25}} className="mt-8 text-[32px] font-[800] leading-tight">{title}</motion.h2>
      <motion.p initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.45}} className="mt-3 max-w-xs text-[16px] text-white/80">{text}</motion.p>
      {view.number && view.goal && view.count === 1 ? <p className="mt-3 rounded-full bg-white/15 px-4 py-1.5 text-[14px] font-[650]">You’re photo #{view.number} of {view.goal}</p> : null}
      {view.spotId && <SpotlightButton id={view.spotId} />}
      {eventId !== 'demo' && <InviteButton eventId={eventId} eventName={eventName} />}
      <button type="button" onClick={onAgain} className="mt-4 w-full max-w-xs rounded-full bg-white py-4 text-[17px] font-[750] text-[#2b0a4a]">{view.count > 1 ? 'Add more photos' : 'Take another photo'}</button>
    </div>
  );
}

function Toast({text, onClose}: {text: string; onClose: () => void}) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t); }, [onClose]);
  return <div role="alert" className="absolute inset-x-5 top-28 rounded-2xl bg-[#ff3d8b] px-4 py-3 text-[14px] font-[600]">{text}</div>;
}

function GalleryIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="1.8" /><path d="m21 15-4.5-4.5L6 21" /></svg>;
}
function FlipIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 21v-5h-5" /></svg>;
}

function Consent() {
  return <p className="mt-3 text-center text-[12px] text-white/60">Your photo will be shown on the event screen. You can remove it later from this phone.</p>;
}

/** "Show me on the big screen": the wall zooms this photo to the centre for a few seconds. */
function SpotlightButton({id}: {id: string}) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | string>('idle');
  async function go() {
    setState('busy');
    try {
      const r = await fetch('/api/spotlight', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Try again in a moment.');
      setState('ok');
      setTimeout(() => setState('idle'), 8000);
    } catch (e) { setState(e instanceof Error ? e.message : 'Try again in a moment.'); setTimeout(() => setState('idle'), 4000); }
  }
  return (
    <div className="mt-8 w-full max-w-xs">
      <button type="button" onClick={go} disabled={state !== 'idle'}
        className="w-full rounded-full py-4 text-[17px] font-[750] text-white disabled:opacity-80" style={{background: 'linear-gradient(90deg,#8a2be2,var(--accent))'}}>
        {state === 'busy' ? 'Sending to the big screen…' : state === 'ok' ? 'Look up! You’re on the big screen' : 'Show me on the big screen'}
      </button>
      {state !== 'idle' && state !== 'busy' && state !== 'ok' && <p className="mt-2 text-[13px] text-white/75">{state}</p>}
    </div>
  );
}

/** Photos sent from this phone; each can be removed (only this phone has the key). */
function MyPhotos({mine, onClose, onRemoved}: {mine: Mine[]; onClose: () => void; onRemoved: (id: string) => void}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function remove(m: Mine) {
    if (!window.confirm('Remove this photo from the wall? This can’t be undone.')) return;
    setBusy(m.id); setError('');
    try {
      const r = await fetch('/api/upload', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: m.id, token: m.token})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Couldn’t remove it. Try again.');
      onRemoved(m.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t remove it.'); }
    finally { setBusy(null); }
  }
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-md px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <h2 className="text-[24px] font-[750]">My photos</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-white/35 px-4 py-2 text-[14px] font-[650]">Done</button>
        </div>
        <p className="mt-1 text-[14px] text-white/70">Photos you sent from this phone. Removing one takes it off the wall.</p>
        {error && <p role="alert" className="mt-3 rounded-2xl bg-[#ff3d8b]/20 px-4 py-3 text-[14px] text-[#ffd1e3]">{error}</p>}
        {mine.length === 0 ? <p className="mt-10 text-center text-white/60">No photos from this phone yet.</p> : (
          <ul className="mt-5 grid grid-cols-2 gap-3">
            {[...mine].reverse().map((m) => (
              <li key={m.id} className="overflow-hidden rounded-2xl bg-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.thumb ? <img src={m.thumb} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full" />}
                <button type="button" onClick={() => remove(m)} disabled={busy === m.id} className="w-full py-2.5 text-[14px] font-[650] text-[#ffb3cf] disabled:opacity-50">{busy === m.id ? 'Removing…' : 'Remove'}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Invite a friend: the phone's share sheet with the upload link, or copy it. */
function InviteButton({eventId, eventName}: {eventId: string; eventName?: string}) {
  const [copied, setCopied] = useState(false);
  async function go() {
    const url = `${window.location.origin}/upload?event=${eventId}`;
    const data = {title: eventName || 'Digital Mosaic Wall', text: 'Add your photo to the big picture!', url};
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch { /* cancelled */ }
  }
  return (
    <button type="button" onClick={go} className="mt-3 w-full max-w-xs rounded-full border border-white/40 py-3.5 text-[16px] font-[650]">
      {copied ? 'Link copied!' : 'Invite a friend'}
    </button>
  );
}
