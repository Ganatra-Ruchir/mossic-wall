'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {StatusCounts, Submission, SubmissionStatus} from '@/lib/types';

// Find, preview, remove and delete guest photos. Removed photos leave the wall within seconds.

type Op = 'approve' | 'reject' | 'delete';
const TABS: {status: SubmissionStatus; label: string}[] = [
  {status: 'pending', label: 'Waiting'},
  {status: 'approved', label: 'On the wall'},
  {status: 'rejected', label: 'Removed'},
];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {...init, headers: {'Content-Type': 'application/json', ...(init?.headers || {})}});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = '/admin/login'; throw new Error('Please log in again'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j as T;
}

export default function PhotoManager({eventId, counts, onChanged, flash}: {eventId: string; counts: StatusCounts; onChanged: () => void; flash: (m: string, error?: boolean) => void}) {
  const [status, setStatus] = useState<SubmissionStatus>('approved');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [list, setList] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useRef(60);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);

  const load = useCallback(async (keepCount = true) => {
    const limit = keepCount ? shown.current : 60;
    setLoading(true);
    try {
      // Fetch the pages currently shown so live refresh doesn't shrink the list.
      const pages = Math.max(1, Math.ceil(limit / 60));
      let rows: Submission[] = [], t = 0, more = false;
      for (let p = 0; p < pages; p++) {
        const j = await call<{submissions: Submission[]; total: number; hasMore: boolean}>(`/api/admin/events/${eventId}/submissions?status=${status}&offset=${p * 60}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`);
        rows = rows.concat(j.submissions); t = j.total; more = j.hasMore;
        if (!j.hasMore) break;
      }
      setList(rows); setTotal(t); setHasMore(more);
      shown.current = Math.max(60, rows.length);
    } catch (e) { flash((e as Error).message, true); }
    finally { setLoading(false); }
  }, [eventId, status, debounced, flash]);

  useEffect(() => { shown.current = 60; setSelected(new Set()); setOpen(null); load(false); }, [status, debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const iv = setInterval(() => { if (!busy && open === null) load(); }, 6000); return () => clearInterval(iv); }, [load, busy, open]);

  async function apply(op: Op, ids: string[], ask = true) {
    if (!ids.length) return;
    if (op === 'delete' && ask && !window.confirm(ids.length === 1 ? 'Delete this photo forever? It can’t be undone.' : `Delete ${ids.length} photos forever? This can’t be undone.`)) return;
    setBusy(true);
    try {
      if (ids.length === 1) {
        if (op === 'delete') await call(`/api/admin/submissions/${ids[0]}`, {method: 'DELETE'});
        else await call(`/api/admin/submissions/${ids[0]}`, {method: 'POST', body: JSON.stringify({action: op})});
      } else {
        await call(`/api/admin/events/${eventId}/submissions`, {method: 'POST', body: JSON.stringify({action: 'bulk', op, ids})});
      }
      const n = ids.length === 1 ? 'Photo' : `${ids.length} photos`;
      flash(op === 'delete' ? `${n} deleted` : op === 'reject' ? `${n} removed from the wall` : `${n} on the wall`);
      setSelected(new Set());
      // Keep the preview on the next photo after acting on one.
      setList((xs) => xs.filter((x) => !ids.includes(x.id)));
      setOpen((o) => (o === null ? null : list.length - ids.length <= 0 ? null : Math.min(o, list.length - ids.length - 1)));
      onChanged();
      load();
    } catch (e) { flash((e as Error).message, true); }
    finally { setBusy(false); }
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = list.length > 0 && list.every((x) => selected.has(x.id));
  const ids = useMemo(() => [...selected], [selected]);

  // Actions that make sense for each section.
  const actions = (st: SubmissionStatus): {op: Op; label: string; tone: 'ok' | 'warn' | 'danger'}[] =>
    st === 'pending' ? [{op: 'approve', label: 'Approve', tone: 'ok'}, {op: 'reject', label: 'Reject', tone: 'warn'}, {op: 'delete', label: 'Delete forever', tone: 'danger'}]
    : st === 'approved' ? [{op: 'reject', label: 'Remove from wall', tone: 'warn'}, {op: 'delete', label: 'Delete forever', tone: 'danger'}]
    : [{op: 'approve', label: 'Put back on wall', tone: 'ok'}, {op: 'delete', label: 'Delete forever', tone: 'danger'}];
  const toneCls = {ok: 'bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25', warn: 'bg-amber-400/15 text-amber-200 hover:bg-amber-400/25', danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25'};

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex gap-2">
          {TABS.map((t) => (
            <button key={t.status} role="tab" aria-selected={status === t.status} type="button" onClick={() => setStatus(t.status)}
              className={`rounded-full px-4 py-2 text-sm ${status === t.status ? 'bg-white font-semibold text-black' : 'border border-zinc-700 text-zinc-300 hover:border-zinc-500'}`}>
              {t.label} <span className={status === t.status ? 'text-zinc-500' : 'text-zinc-500'}>{counts[t.status]}</span>
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or message" aria-label="Search photos"
          className="w-full max-w-xs rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm outline-none focus:border-zinc-400" />
      </div>

      <div className="mt-4 flex min-h-[40px] flex-wrap items-center gap-2 text-sm">
        {list.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((x) => x.id)))} className="h-4 w-4 accent-white" />
            Select all shown
          </label>
        )}
        {ids.length > 0 && (
          <>
            <span className="ml-2 text-zinc-300">{ids.length} selected</span>
            {actions(status).map((a) => (
              <button key={a.op} type="button" disabled={busy} onClick={() => apply(a.op, ids)} className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${toneCls[a.tone]}`}>{a.label}</button>
            ))}
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:text-white">Clear selection</button>
          </>
        )}
        {status === 'pending' && counts.pending > 0 && ids.length === 0 && (
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const j = await call<{approved: number}>(`/api/admin/events/${eventId}/submissions`, {method: 'POST', body: JSON.stringify({action: 'approve_all'})}); flash(`Approved ${j.approved}`); onChanged(); load(); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); } }}
            className="rounded-full bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-50">Approve all waiting ({counts.pending})</button>
        )}
        <span className="ml-auto text-xs text-zinc-500">{debounced ? `${total} match “${debounced}”` : `${total} photos`}</span>
      </div>

      {list.length === 0 ? (
        <p className="mt-16 text-center text-sm text-zinc-500">
          {loading ? 'Loading…' : debounced ? 'No photos match that search.' : status === 'pending' ? 'Nothing waiting. New uploads appear here when moderation is on.' : status === 'approved' ? 'No photos on the wall yet.' : 'No removed photos.'}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {list.map((s, i) => {
            const on = selected.has(s.id);
            return (
              <li key={s.id} className={`group relative overflow-hidden rounded-xl border bg-zinc-950 ${on ? 'border-white ring-2 ring-white/60' : 'border-zinc-800'}`}>
                <button type="button" onClick={() => setOpen(i)} className="block w-full" aria-label={`Open photo from ${s.name || 'a guest'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumbnail_url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                </button>
                <label className={`absolute left-2 top-2 grid h-7 w-7 cursor-pointer place-items-center rounded-full ${on ? 'bg-white' : 'bg-black/55 opacity-80 group-hover:opacity-100'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="sr-only" aria-label="Select photo" />
                  <span className={`text-sm font-bold ${on ? 'text-black' : 'text-white/80'}`}>{on ? '✓' : ''}</span>
                </label>
                <div className="p-2">
                  <p className="truncate text-xs text-zinc-300">{s.name || 'Anonymous'}</p>
                  <p className="truncate text-[11px] text-zinc-500">{s.message || new Date(s.created_at).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</p>
                  {s.status === 'approved' && s.tile_index == null && <p className="mt-0.5 text-[11px] text-amber-300">Waiting for a free tile</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 text-center">
          <button type="button" disabled={loading} onClick={() => { shown.current += 60; load(); }} className="rounded-full border border-zinc-700 px-5 py-2 text-sm hover:border-zinc-400 disabled:opacity-50">
            {loading ? 'Loading…' : `Load more (${total - list.length} more)`}
          </button>
        </div>
      )}

      {open !== null && list[open] && (
        <Lightbox photo={list[open]} index={open} count={list.length} busy={busy} actions={actions(status)} toneCls={toneCls}
          onClose={() => setOpen(null)} onPrev={() => setOpen((o) => (o! > 0 ? o! - 1 : o))} onNext={() => setOpen((o) => (o! < list.length - 1 ? o! + 1 : o))}
          onAct={(op) => apply(op, [list[open].id])} />
      )}
    </div>
  );
}

function Lightbox({photo, index, count, busy, actions, toneCls, onClose, onPrev, onNext, onAct}: {
  photo: Submission; index: number; count: number; busy: boolean;
  actions: {op: Op; label: string; tone: 'ok' | 'warn' | 'danger'}[]; toneCls: Record<'ok' | 'warn' | 'danger', string>;
  onClose: () => void; onPrev: () => void; onNext: () => void; onAct: (op: Op) => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') onPrev(); if (e.key === 'ArrowRight') onNext(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, onPrev, onNext]);
  // Rendered into <body>: the admin panel's backdrop blur would otherwise trap a fixed overlay inside it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Photo preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-5xl flex-col gap-4 md:flex-row" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-h-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.image_url} alt={`Photo from ${photo.name || 'a guest'}`} className="mx-auto max-h-[78vh] w-auto rounded-2xl object-contain" />
          <button type="button" onClick={onPrev} disabled={index === 0} aria-label="Previous photo" className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-xl disabled:opacity-30">‹</button>
          <button type="button" onClick={onNext} disabled={index >= count - 1} aria-label="Next photo" className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-xl disabled:opacity-30">›</button>
        </div>
        <aside className="glass w-full shrink-0 rounded-2xl p-5 md:w-72">
          <p className="text-lg font-semibold">{photo.name || 'Anonymous'}</p>
          {photo.message && <p className="mt-2 text-sm text-zinc-300">“{photo.message}”</p>}
          <p className="mt-3 text-xs text-zinc-500">Uploaded {new Date(photo.created_at).toLocaleString()}</p>
          <p className="mt-1 text-xs text-zinc-500">{photo.status === 'approved' ? (photo.tile_index == null ? 'Approved, waiting for a free tile' : 'On the wall') : photo.status === 'pending' ? 'Waiting for approval' : 'Removed from the wall'}</p>
          <div className="mt-5 grid gap-2">
            {actions.map((a) => (
              <button key={a.op} type="button" disabled={busy} onClick={() => onAct(a.op)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${toneCls[a.tone]}`}>{a.label}</button>
            ))}
          </div>
          <p className="mt-5 text-xs text-zinc-500">Photo {index + 1} of {count}. Use ← → to browse, Esc to close.</p>
          <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl border border-zinc-700 py-2 text-sm">Close</button>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

/** Danger zone: delete every guest photo of the event (for clearing test photos before the real event). */
export function ClearAllPhotos({eventId, eventName, onDone, flash}: {eventId: string; eventName: string; onDone: () => void; flash: (m: string, error?: boolean) => void}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const j = await call<{deleted: number}>(`/api/admin/events/${eventId}/submissions`, {method: 'POST', body: JSON.stringify({action: 'clear_all', confirm: typed})});
      flash(`Deleted ${j.deleted} photos. The wall is empty again.`);
      setOpen(false); setTyped(''); onDone();
    } catch (e) { flash((e as Error).message, true); }
    finally { setBusy(false); }
  }
  return (
    <div className="rounded-2xl border border-red-500/30 p-5">
      <h3 className="font-semibold text-red-300">Delete all photos</h3>
      <p className="mt-1 text-sm text-zinc-400">Removes every guest photo from this event and the wall, for example test photos before the real event. Settings and the target image stay. This can’t be undone.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 rounded-full border border-red-500/50 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10">Delete all photos…</button>
      ) : (
        <div className="mt-4 grid max-w-md gap-2">
          <label className="text-xs text-zinc-400" htmlFor="clear-confirm">Type the event name <b className="text-zinc-200">{eventName}</b> to confirm</label>
          <input id="clear-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-red-400" />
          <div className="flex gap-2">
            <button type="button" disabled={busy || typed.trim() !== eventName} onClick={go} className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Deleting…' : 'Delete all photos'}</button>
            <button type="button" onClick={() => { setOpen(false); setTyped(''); }} className="rounded-full border border-zinc-700 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
