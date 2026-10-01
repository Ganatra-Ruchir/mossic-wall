'use client';
import '@fontsource-variable/bricolage-grotesque';
import {zip} from 'fflate';
import {useState} from 'react';
import {WallEngine, type WallPhoto} from '@/components/wall/WallEngine';
import {normalizeDesign} from '@/lib/design';
import type {Event, Submission} from '@/lib/types';

// Keepsakes: the finished picture (download or share with guests), a timelapse video, all photos as a ZIP.
// Everything is built in this browser from the live data, so it works after the event too.

const DEFAULT_TARGET = '/targets/micron.jpg';
const FONT = '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mosaic';

/** A hidden 1920×1080 wall to render from. */
function stage() {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-30000px;top:0;width:1920px;height:1080px;pointer-events:none';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1920px;height:1080px;display:block';
  div.appendChild(canvas);
  document.body.appendChild(div);
  return {canvas, done: () => div.remove()};
}

async function wallData(eventId: string): Promise<{event: Event; tiles: {id: string; thumbnail_url: string; image_url: string; name: string | null; message: string | null}[]}> {
  const r = await fetch(`/api/wall/${eventId}`, {cache: 'no-store'});
  if (!r.ok) throw new Error('Could not load the wall');
  return r.json();
}

async function waitFor(cond: () => boolean, timeout: number) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > timeout) return false; await sleep(100); }
  return true;
}

/** Build the finished mosaic off-screen and export it as a JPEG. */
async function renderPicture(eventId: string, maxEdge: number, onStep: (m: string) => void) {
  const {event, tiles} = await wallData(eventId);
  if (!tiles.length) throw new Error('There are no photos on the wall yet.');
  const design = normalizeDesign(event.design);
  const {canvas, done} = stage();
  let phase = 'gallery';
  const e = new WallEngine(canvas, Math.max(2, tiles.length + 1), {onPhase: (p) => { phase = p; }}, 4, {dpr: 1});
  try {
    e.setDesign({...design, speed: 4, confetti: false, spotlight: false, tour: false});
    e.setArea(40, 40);
    onStep('Loading photos…');
    await e.setTarget(event.target_image_url || DEFAULT_TARGET);
    e.sync(tiles.map((t) => ({id: t.id, thumb: t.thumbnail_url, full: t.image_url})), false);
    await waitFor(() => e.isReady(), 60000);
    onStep('Building the picture…');
    e.reveal();
    if (!(await waitFor(() => phase === 'mosaic', 20000))) throw new Error('The picture took too long to build. Try again.');
    await sleep(300);
    // At least 4K wide (fewer photos = bigger cells, drawn from the full-size photos).
    const g = e.gridSize();
    const blob = await e.exportImage(Math.max(128, Math.ceil(Math.min(3840, maxEdge) / Math.max(1, g.cols))), maxEdge);
    if (!blob) throw new Error('Could not create the picture.');
    return {blob, event};
  } finally { e.destroy(); done(); }
}

export default function Keepsakes({event, onChanged}: {event: Event; onChanged: () => void}) {
  const [busy, setBusy] = useState<'' | 'picture' | 'share' | 'video' | 'zip'>('');
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const ended = event.status === 'ended';

  async function run(kind: typeof busy, fn: () => Promise<void>) {
    setBusy(kind); setError(''); setStep('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(''); setStep(''); }
  }

  const picture = () => run('picture', async () => {
    const {blob} = await renderPicture(event.id, 8000, setStep);
    download(blob, `${slug(event.name)}-mosaic.jpg`);
  });

  const share = () => run('share', async () => {
    const {blob} = await renderPicture(event.id, 3200, setStep);
    setStep('Sharing with guests…');
    const fd = new FormData();
    fd.append('file', blob, 'mosaic.jpg');
    const r = await fetch(`/api/admin/events/${event.id}/final`, {method: 'POST', body: fd});
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not share the picture');
    onChanged();
  });

  const unshare = () => run('share', async () => {
    const r = await fetch(`/api/admin/events/${event.id}/final`, {method: 'DELETE'});
    if (!r.ok) throw new Error('Could not stop sharing');
    onChanged();
  });

  /** Timelapse: photos arrive in order, then the reveal; recorded from a 1920×1080 canvas. */
  const video = () => run('video', async () => {
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser can’t record video. Use Chrome or Edge on a computer.');
    const {event: ev, tiles} = await wallData(event.id);
    if (!tiles.length) throw new Error('There are no photos on the wall yet.');
    const design = normalizeDesign(ev.design);
    const {canvas, done} = stage();
    const comp = document.createElement('canvas');
    comp.width = 1920; comp.height = 1080;
    const cx = comp.getContext('2d')!;
    let phase = 'gallery', count = 0, raf = 0;
    const e = new WallEngine(canvas, Math.max(2, tiles.length + 1), {onPhase: (p) => { phase = p; }, onCount: (n) => { count = n; }}, 2.5, {dpr: 1});
    try {
      e.setDesign({...design, speed: 2.5, arrival: tiles.length <= 60 ? 'direct' : 'pop', spotlight: false, tour: false});
      e.setArea(150, 130);
      setStep('Loading photos…');
      await e.setTarget(ev.target_image_url || DEFAULT_TARGET);
      // Warm the image cache so photos appear instantly in the recording.
      await Promise.all(tiles.map((t) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = t.thumbnail_url; })));
      await document.fonts.ready;

      // Composite: background + glows + the wall + title and counter (the live wall draws these with HTML).
      const draw = (now: number) => {
        cx.fillStyle = design.background;
        cx.fillRect(0, 0, 1920, 1080);
        if (design.glows) {
          const a = design.glowStrength / 100;
          for (const [x, y, r, col] of [[300 + Math.sin(now / 5000) * 120, 200, 700, '#8a0fc2'], [1650, 650 + Math.cos(now / 6000) * 90, 650, design.accent], [900, 1150, 700, '#00b7ff']] as const) {
            const g = cx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, col + Math.round(a * 140).toString(16).padStart(2, '0'));
            g.addColorStop(1, col + '00');
            cx.fillStyle = g;
            cx.fillRect(0, 0, 1920, 1080);
          }
        }
        cx.drawImage(canvas, 0, 0, 1920, 1080);
        cx.fillStyle = '#fff';
        if (phase === 'gallery') { cx.font = `750 56px ${FONT}`; cx.fillText(ev.name, 72, 108); }
        cx.font = `800 84px ${FONT}`;
        cx.fillText(String(count), 72, 1010);
        const w = cx.measureText(String(count)).width;
        cx.font = `500 34px ${FONT}`;
        cx.globalAlpha = 0.85;
        cx.fillText(phase === 'gallery' ? 'photos' : 'photos, one picture', 72 + w + 18, 1010);
        cx.globalAlpha = 1;
        if (phase === 'mosaic') {
          cx.font = `800 96px ${FONT}`;
          cx.textAlign = 'center';
          cx.fillText(ev.final_message || 'We did it together', 960, 108);
          cx.textAlign = 'left';
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      // H.264 MP4 plays everywhere (phones, WhatsApp, PowerPoint); Chrome and Edge can record it. Otherwise WebM.
      const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(comp.captureStream(30), {mimeType: mime || undefined, videoBitsPerSecond: 8_000_000});
      const chunks: Blob[] = [];
      rec.ondataavailable = (x) => { if (x.data.size) chunks.push(x.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });
      rec.start(250);
      await sleep(800);

      // About 6–20 s of photos arriving, whatever the number of photos.
      const build = Math.min(20000, Math.max(6000, tiles.length * 250));
      const gap = build / tiles.length;
      const list: WallPhoto[] = [];
      for (let i = 0; i < tiles.length; i++) {
        list.push({id: tiles[i].id, thumb: tiles[i].thumbnail_url, name: tiles[i].name});
        e.sync(list, true);
        setStep(`Recording: photo ${i + 1} of ${tiles.length}… keep this tab open`);
        await sleep(gap);
      }
      await waitFor(() => e.placedCount() >= tiles.length, 15000);
      await sleep(1000);
      setStep('Recording the reveal…');
      e.reveal();
      await waitFor(() => phase === 'mosaic', 20000);
      await sleep(4500);
      rec.stop();
      await stopped;
      const ext = (rec.mimeType || mime).includes('mp4') ? 'mp4' : 'webm';
      download(new Blob(chunks, {type: rec.mimeType || mime || 'video/webm'}), `${slug(ev.name)}-timelapse.${ext}`);
    } finally { cancelAnimationFrame(raf); e.destroy(); done(); }
  });

  const photos = () => run('zip', async () => {
    let list: Submission[] = [], offset = 0;
    for (;;) {
      const r = await fetch(`/api/admin/events/${event.id}/submissions?status=approved&offset=${offset}`, {cache: 'no-store'});
      if (!r.ok) throw new Error('Could not load the photos');
      const j = await r.json();
      list = list.concat(j.submissions);
      offset += j.submissions.length;
      if (!j.hasMore || !j.submissions.length) break;
    }
    if (!list.length) throw new Error('There are no photos on the wall yet.');
    list.reverse(); // oldest first
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < list.length; i++) {
      setStep(`Collecting photo ${i + 1} of ${list.length}…`);
      const r = await fetch(list[i].image_url);
      if (!r.ok) continue;
      files[`${String(i + 1).padStart(3, '0')}-${slug(list[i].name || 'guest')}.jpg`] = new Uint8Array(await r.arrayBuffer());
    }
    setStep('Creating the ZIP…');
    const data = await new Promise<Uint8Array>((res, rej) => zip(files, {level: 0}, (err, out) => (err ? rej(err) : res(out))));
    download(new Blob([data as BlobPart], {type: 'application/zip'}), `${slug(event.name)}-photos.zip`);
  });

  const btn = 'rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40';
  return (
    <section className={`rounded-2xl border p-5 ${ended ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-zinc-800'}`}>
      <h3 className="font-semibold">{ended ? 'The event has ended: download your keepsakes' : 'Keepsakes'}</h3>
      <p className="mt-1 text-sm text-zinc-400">Built from the photos on the wall right now{ended ? '' : '; you can do this again after the event'}. Keep this tab open while it works.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 p-4">
          <p className="text-sm font-semibold">Final picture</p>
          <p className="mt-1 text-xs text-zinc-500">High-resolution image of the finished mosaic.</p>
          <button type="button" disabled={!!busy} onClick={picture} className={`${btn} mt-3 bg-white text-black`}>{busy === 'picture' ? 'Creating…' : 'Download picture'}</button>
          <div className="mt-2">
            {event.final_image_url ? (
              <p className="text-xs text-emerald-300">Shared with guests. <a href={`/upload?event=${event.id}`} target="_blank" className="underline">See guest page</a>{" "}<button type="button" disabled={!!busy} onClick={unshare} className="underline">Stop sharing</button></p>
            ) : (
              <button type="button" disabled={!!busy} onClick={share} className="text-xs text-zinc-300 underline disabled:opacity-40">{busy === 'share' ? 'Sharing…' : 'Share with guests'}</button>
            )}
            <p className="mt-1 text-[11px] text-zinc-500">Shared pictures appear on the guest page once the event has ended.</p>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 p-4">
          <p className="text-sm font-semibold">Timelapse video</p>
          <p className="mt-1 text-xs text-zinc-500">Every photo arriving, then the reveal. 1080p, about 15–30 seconds. MP4 in Chrome or Edge.</p>
          <button type="button" disabled={!!busy} onClick={video} className={`${btn} mt-3 bg-white text-black`}>{busy === 'video' ? 'Recording…' : 'Record video'}</button>
        </div>
        <div className="rounded-xl border border-zinc-800 p-4">
          <p className="text-sm font-semibold">All photos</p>
          <p className="mt-1 text-xs text-zinc-500">Every photo on the wall in one ZIP, named by guest.</p>
          <button type="button" disabled={!!busy} onClick={photos} className={`${btn} mt-3 bg-white text-black`}>{busy === 'zip' ? 'Preparing…' : 'Download ZIP'}</button>
        </div>
      </div>
      {step && <p className="mt-3 text-sm text-zinc-300">{step}</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}
