'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {DEFAULT_DESIGN, normalizeDesign, type Design} from '@/lib/design';
import type {Event} from '@/lib/types';

// Admin → Design: everything about how the wall looks and moves, with a live preview.

type Props = {event: Event; onSave: (patch: Partial<Event> & {design?: Design; reveal?: boolean}, ok?: string) => Promise<void> | void};

export default function DesignEditor({event, onSave}: Props) {
  const saved = normalizeDesign(event.design, {fly_from: event.fly_from, animation_speed: event.animation_speed});
  const [d, setD] = useState<Design>(saved);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const savedKey = JSON.stringify(saved);
  const dirty = JSON.stringify(d) !== savedKey;
  const set = <K extends keyof Design>(k: K, v: Design[K]) => setD((x) => ({...x, [k]: v}));

  // Re-sync when the server copy changes and there are no local edits.
  const lastSaved = useRef(savedKey);
  useEffect(() => { if (savedKey !== lastSaved.current) { if (!dirty) setD(saved); lastSaved.current = savedKey; } }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push the draft into the preview frame.
  const push = useCallback(() => {
    frame.current?.contentWindow?.postMessage({type: 'mosaic-design', design: d, title: event.name, target: event.target_image_url || ''}, window.location.origin);
  }, [d, event.name, event.target_image_url]);
  useEffect(() => { push(); }, [push]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'mosaic-preview-ready') push(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [push]);

  async function save() { setBusy(true); try { await onSave({design: d}, 'Design saved. Open walls update within a few seconds.'); } finally { setBusy(false); } }
  async function revealLive() {
    if (!window.confirm('Play the big-picture reveal now on every open wall? Photos rearrange into the target image even if the goal isn’t reached yet.')) return;
    await onSave({reveal: true}, 'Reveal sent to the wall');
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="grid content-start gap-6">
        <Group title="Background">
          <Color label="Background colour" value={d.background} onChange={(v) => set('background', v)} />
          <Toggle label="Colour glows" hint="Slowly drifting pink, blue and orange light" value={d.glows} onChange={(v) => set('glows', v)} />
          {d.glows && <Slider label="Glow strength" value={d.glowStrength} min={0} max={100} unit="%" onChange={(v) => set('glowStrength', v)} />}
          <Color label="Accent colour" hint="Progress bar and the guest page buttons" value={d.accent} onChange={(v) => set('accent', v)} />
        </Group>

        <Group title="Photos while the wall fills">
          <Slider label="Photo size" value={d.photoSize} min={50} max={150} unit="%" onChange={(v) => set('photoSize', v)} hint="100% = comfortable print size; photos still shrink as more arrive" />
          <Slider label="Space between photos" value={d.gap} min={0} max={25} unit="%" onChange={(v) => set('gap', v)} />
          <Toggle label="Border" value={d.frame} onChange={(v) => set('frame', v)} />
          {d.frame && <>
            <Color label="Border colour" value={d.frameColor} onChange={(v) => set('frameColor', v)} />
            <Slider label="Border thickness" value={d.frameWidth} min={1} max={12} unit="%" onChange={(v) => set('frameWidth', v)} />
          </>}
          <Slider label="Rounded corners" value={d.corner} min={0} max={50} unit="%" onChange={(v) => set('corner', v)} hint="50% makes round photos" />
          <Toggle label="Shadow" value={d.shadow} onChange={(v) => set('shadow', v)} />
          <Toggle label="Tilted prints" hint="Each photo slightly angled, like pinned photos" value={d.tilt} onChange={(v) => set('tilt', v)} />
        </Group>

        <Group title="Animation">
          <Choice label="How new photos arrive" value={d.arrival} onChange={(v) => set('arrival', v)}
            options={[['loop', 'Loop across the wall'], ['direct', 'Fly straight in'], ['pop', 'Pop in place']]} />
          {d.arrival !== 'pop' && <Choice label="Fly in from" value={d.flyFrom} onChange={(v) => set('flyFrom', v)}
            options={[['random', 'Any side'], ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]} />}
          <Slider label="Animation speed" value={d.speed} min={0.5} max={3} step={0.25} unit="×" onChange={(v) => set('speed', v)} />
          <Toggle label="Confetti" hint="Bursts when a photo lands and at the reveal" value={d.confetti} onChange={(v) => set('confetti', v)} />
        </Group>

        <Group title="The big picture">
          <Slider label="Picture strength" value={d.pictureStrength} min={0} max={90} unit="%" onChange={(v) => set('pictureStrength', v)} hint="How clearly the target image shows over the photos" />
          <Slider label="Picture size on screen" value={d.mosaicFill} min={60} max={100} unit="%" onChange={(v) => set('mosaicFill', v)} />
          <Slider label="Space between tiles" value={d.mosaicGap} min={0} max={10} unit="%" onChange={(v) => set('mosaicGap', v)} />
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => frame.current?.contentWindow?.postMessage({type: 'mosaic-reveal'}, window.location.origin)} className="rounded-full border border-zinc-600 px-4 py-2 text-sm hover:border-zinc-400">Play reveal in preview</button>
            <button type="button" onClick={revealLive} className="rounded-full border border-amber-400/50 px-4 py-2 text-sm text-amber-200 hover:bg-amber-400/10">Play reveal now on the live wall</button>
          </div>
        </Group>

        <Group title="On screen">
          <Toggle label="Event name and tagline" value={d.showTitle} onChange={(v) => set('showTitle', v)} />
          {d.showTitle && <label className="block"><span className="text-xs text-zinc-500">Tagline (leave empty for the default)</span>
            <input value={d.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} placeholder="Every photo you add becomes part of the picture" className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500" /></label>}
          <Toggle label="QR code card" value={d.showQr} onChange={(v) => set('showQr', v)} />
          <Toggle label="Photo counter and progress bar" value={d.showCounter} onChange={(v) => set('showCounter', v)} />
          <Toggle label="Guest names as photos arrive" value={d.showCaptions} onChange={(v) => set('showCaptions', v)} />
          <p className="text-xs text-zinc-500">Fullscreen on the wall (F) hides all of these at once.</p>
        </Group>

        <Group title="Extra moments">
          <Toggle label="Spotlight when it’s quiet" hint="If no photos arrive for 20 seconds, show a random guest’s photo large for a few seconds" value={d.spotlight} onChange={(v) => set('spotlight', v)} />
          <Toggle label="Milestone celebrations" hint="Banner and confetti at 25%, 50% and 75% of the goal" value={d.milestones} onChange={(v) => set('milestones', v)} />
          <Toggle label="Close-up tour after the reveal" hint="The finished picture slowly zooms into different areas so people can find their photos" value={d.tour} onChange={(v) => set('tour', v)} />
          <Toggle label="“Join us” reminder" hint="After a minute without new photos, a big QR card asks people to scan and join" value={d.callToAction} onChange={(v) => set('callToAction', v)} />
          <p className="text-xs text-zinc-500">Guests can also tap “Show me on the big screen” after sending a photo.</p>
        </Group>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
          <div className="relative aspect-video w-full">
            <iframe ref={frame} src="/wall?simulate=1&preview=1" title="Wall preview" className="absolute inset-0 h-full w-full" onLoad={push} />
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Live preview with sample photos: new ones keep arriving so you can see the animation. Changes show here instantly; the real wall changes after you save.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!dirty || busy} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40">{busy ? 'Saving…' : dirty ? 'Save design' : 'Saved'}</button>
          {dirty && <button type="button" onClick={() => setD(saved)} className="rounded-full border border-zinc-700 px-4 py-2.5 text-sm">Discard changes</button>}
          <button type="button" onClick={() => { if (window.confirm('Reset every design setting to the default look? You can still discard before saving.')) setD({...DEFAULT_DESIGN}); }} className="rounded-full px-4 py-2.5 text-sm text-zinc-400 hover:text-white">Reset to defaults</button>
          <a href={`/wall?event=${event.id}`} target="_blank" className="ml-auto rounded-full border border-zinc-700 px-4 py-2.5 text-sm">Open the real wall</a>
        </div>
        {dirty && <p className="mt-2 text-xs text-amber-300">Unsaved changes</p>}
      </div>
    </div>
  );
}

function Group({title, children}: {title: string; children: React.ReactNode}) {
  return <section className="rounded-2xl border border-zinc-800 p-5"><h3 className="font-semibold">{title}</h3><div className="mt-4 grid gap-4">{children}</div></section>;
}

function Slider({label, value, min, max, step = 1, unit, hint, onChange}: {label: string; value: number; min: number; max: number; step?: number; unit: string; hint?: string; onChange: (v: number) => void}) {
  return (
    <label className="block">
      <span className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-zinc-400">{value}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-white" />
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function Toggle({label, hint, value, onChange}: {label: string; hint?: string; value: boolean; onChange: (v: boolean) => void}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span><span className="text-sm">{label}</span>{hint && <span className="block text-xs text-zinc-500">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? 'bg-white' : 'bg-zinc-700'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full transition ${value ? 'left-[22px] bg-black' : 'left-0.5 bg-zinc-300'}`} />
      </button>
    </div>
  );
}

function Color({label, hint, value, onChange}: {label: string; hint?: string; value: string; onChange: (v: string) => void}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex items-center justify-between gap-4">
      <span><span className="text-sm">{label}</span>{hint && <span className="block text-xs text-zinc-500">{hint}</span>}</span>
      <span className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-9 w-12 cursor-pointer rounded-lg border border-zinc-700 bg-transparent" />
        <input value={text} onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} aria-label={`${label} hex`} maxLength={7}
          className="w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-500" />
      </span>
    </div>
  );
}

function Choice<T extends string>({label, value, options, onChange}: {label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void}) {
  return (
    <div>
      <span className="text-sm">{label}</span>
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`rounded-xl border px-3 py-1.5 text-sm ${value === v ? 'border-white bg-white text-black' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}
