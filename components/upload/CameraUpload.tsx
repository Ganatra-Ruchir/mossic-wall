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

type Result = 'approved' | 'pending' | 'waiting' | 'demo';
type Item = {id: string; file: File; url: string; state: 'waiting' | 'sending' | 'done' | 'error'; error?: string; progress: number};
type View =
  | {kind: 'camera'}
  | {kind: 'shot'; blob: Blob; url: string}
  | {kind: 'batch'}
  | {kind: 'done'; count: number; failed: number; result: Result; url?: string};

/** Upload one photo with progress. */
function send(blob: Blob, eventId: string, name: string, message: string, onProgress: (p: number) => void): Promise<Result> {
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
      const j = (x.response ?? {}) as {status?: string; error?: string};
      if (x.status >= 200 && x.status < 300) resolve(j.status === 'pending' || j.status === 'waiting' || j.status === 'demo' ? j.status : 'approved');
      else reject(new Error(j.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('No connection. Check your signal and try again.'));
    x.ontimeout = () => reject(new Error('The upload took too long. Try again.'));
    x.send(fd);
  });
}

export default function CameraUpload({eventId, eventName}: {eventId: string; eventName?: string}) {
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
    c.toBlob((b) => { if (b) { stop(); setError(''); setView({kind: 'shot', blob: b, url: URL.createObjectURL(b)}); } }, 'image/jpeg', 0.9);
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
      const result = await send(v.blob, eventId, name, message, setProgress);
      setMessage('');
      setView({kind: 'done', count: 1, failed: 0, result, url: v.url});
      navigator.vibrate?.(20);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); }
  }

  async function sendBatch() {
    setBusy(true); setError('');
    let ok = 0, failed = 0, last: Result = 'approved';
    for (const it of items) {
      if (it.state === 'done') { ok++; continue; }
      setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'sending', progress: 0, error: undefined} : x)));
      try {
        const blob = await shrinkImage(it.file);
        last = await send(blob, eventId, name, message, (p) => setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, progress: p} : x))));
        ok++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'done', progress: 1} : x)));
      } catch (e) {
        failed++;
        setItems((xs) => xs.map((x) => (x.id === it.id ? {...x, state: 'error', error: e instanceof Error ? e.message : 'Failed'} : x)));
      }
    }
    setBusy(false);
    if (failed === 0) { setMessage(''); setView({kind: 'done', count: ok, failed, result: last, url: items[0]?.url}); navigator.vibrate?.(20); }
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
    <main className="fixed inset-0 select-none overflow-hidden bg-black text-white" style={{fontFamily: FONT}}>
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />
      <input ref={nativeCamRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />

      {/* ——— Camera ——— */}
      {view.kind === 'camera' && (
        <div className="absolute inset-0">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{transform: facing === 'user' ? 'scaleX(-1)' : undefined}} />
          {camera === 'on' && <SquareGuide />}
          {(camera === 'denied' || camera === 'unavailable') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1d0633] px-8 text-center">
              <h2 className="text-[28px] font-[750] leading-tight">{camera === 'denied' ? 'Camera access is off' : 'Camera isn’t available here'}</h2>
              <p className="mt-3 max-w-xs text-[15px] text-white/75">
                {camera === 'denied' ? 'Allow camera access for this site in your browser settings, or use the buttons below.' : 'You can still take a photo with your phone’s camera or pick some from your gallery.'}
              </p>
              <button type="button" onClick={() => nativeCamRef.current?.click()} className="mt-8 w-full max-w-xs rounded-full bg-white py-4 text-[17px] font-[700] text-[#2b0a4a]">Take a photo</button>
              <button type="button" onClick={() => galleryRef.current?.click()} className="mt-3 w-full max-w-xs rounded-full border border-white/40 py-4 text-[17px] font-[650]">Choose from gallery</button>
            </div>
          )}
          <TopBar eventName={eventName} />
          {camera !== 'denied' && camera !== 'unavailable' && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-[max(28px,env(safe-area-inset-bottom))] pt-6" style={{background: 'linear-gradient(transparent, rgba(0,0,0,.55))'}}>
              <button type="button" aria-label="Choose photos from your gallery" onClick={() => galleryRef.current?.click()}
                className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border-2 border-white/90 bg-white/15 backdrop-blur">
                {lastThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lastThumb} alt="" className="h-full w-full object-cover" />
                ) : <GalleryIcon />}
              </button>
              <button type="button" aria-label="Take photo" onClick={shoot} disabled={camera !== 'on'}
                className="grid h-[84px] w-[84px] place-items-center rounded-full border-[5px] border-white disabled:opacity-40">
                <span className="h-[64px] w-[64px] rounded-full bg-white transition active:scale-90" />
              </button>
              <button type="button" aria-label="Switch camera" onClick={() => { setCamera('starting'); setFacing((f) => (f === 'user' ? 'environment' : 'user')); }}
                className="grid h-14 w-14 place-items-center rounded-full bg-white/15 backdrop-blur">
                <FlipIcon />
              </button>
            </div>
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
            <img src={view.url} alt="Your photo" className="aspect-square w-full object-cover" />
          </div>
          <Fields name={name} setName={rememberName} message={message} setMessage={setMessage} disabled={busy} />
          {error && <p role="alert" className="mt-3 rounded-2xl bg-[#ff3d8b]/20 px-4 py-3 text-[14px] text-[#ffd1e3]">{error}</p>}
          <PrimaryButton onClick={() => sendShot(view)} busy={busy} progress={progress} label="Add to the mosaic" />
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
          <button type="button" onClick={backToCamera} disabled={busy} className="mt-3 w-full rounded-full border border-white/35 py-3.5 text-[16px] font-[650]">Back to camera</button>
        </Sheet>
      )}

      {/* ——— Sent ——— */}
      {view.kind === 'done' && <Done view={view} onAgain={backToCamera} />}
    </main>
  );
}

function TopBar({eventName}: {eventName?: string}) {
  return (
    <div className="absolute inset-x-0 top-0 px-5 pb-8 pt-[max(18px,env(safe-area-inset-top))]" style={{background: 'linear-gradient(rgba(0,0,0,.55), transparent)'}}>
      <p className="text-[15px] font-[650] text-white/85">{eventName || 'Digital Mosaic Wall'}</p>
      <p className="mt-0.5 text-[22px] font-[750] leading-tight">Add your photo to the big picture</p>
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
    <div className="absolute inset-0 overflow-y-auto" style={{background: 'radial-gradient(120% 70% at 0% 0%, #8a0fc2 0%, transparent 60%), radial-gradient(90% 60% at 100% 100%, #ff3d8b 0%, transparent 60%), #1d0633'}}>
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
      className="relative mt-5 w-full overflow-hidden rounded-full py-4 text-[17px] font-[750] text-white shadow-[0_10px_30px_rgba(255,61,139,.35)] disabled:opacity-70"
      style={{background: 'linear-gradient(90deg,#8a2be2,#ff3d8b)'}}>
      {busy && <span className="absolute inset-y-0 left-0 bg-white/25 transition-[width]" style={{width: `${Math.round(progress * 100)}%`}} />}
      <span className="relative">{busy ? 'Sending…' : label}</span>
    </button>
  );
}

function Done({view, onAgain}: {view: Extract<View, {kind: 'done'}>; onAgain: () => void}) {
  const title = view.result === 'demo' ? 'Demo mode: not saved'
    : view.result === 'pending' ? (view.count > 1 ? `${view.count} photos sent!` : 'Photo sent!')
    : view.count > 1 ? `${view.count} photos are on the wall!` : 'You’re on the wall!';
  const text = view.result === 'pending' ? 'They’ll appear on the big screen as soon as the host approves them.'
    : view.result === 'waiting' ? 'Every spot is taken right now. Your photo joins as soon as one frees up.'
    : view.result === 'demo' ? 'This site isn’t connected to a database yet.'
    : view.count > 1 ? 'Look at the big screen: your photos are flying into the mosaic.' : 'Look at the big screen: your photo is flying into the mosaic.';
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center" style={{background: 'radial-gradient(100% 60% at 50% 30%, #8a0fc2 0%, #1d0633 70%)'}}>
      <motion.div initial={{scale: 0.3, rotate: -12, opacity: 0}} animate={{scale: 1, rotate: -4, opacity: 1}} transition={{type: 'spring', stiffness: 180, damping: 14}}
        className="h-40 w-40 overflow-hidden rounded-[22px] border-[6px] border-white shadow-[0_20px_50px_rgba(0,0,0,.45)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {view.url && <img src={view.url} alt="" className="h-full w-full object-cover" />}
      </motion.div>
      <motion.h2 initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 0.25}} className="mt-8 text-[32px] font-[800] leading-tight">{title}</motion.h2>
      <motion.p initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.45}} className="mt-3 max-w-xs text-[16px] text-white/80">{text}</motion.p>
      <button type="button" onClick={onAgain} className="mt-10 w-full max-w-xs rounded-full bg-white py-4 text-[17px] font-[750] text-[#2b0a4a]">{view.count > 1 ? 'Add more photos' : 'Take another photo'}</button>
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
