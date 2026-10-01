// Canvas engine for the big-screen wall.
//
// Two phases:
//  • gallery: photos sit in framed tiles sized for the current count (big when
//    there are few, shrinking smoothly as more arrive). Each new photo flies in
//    from the edge, loops across the wall and pops into its slot.
//  • mosaic: once `goal` photos are in, every tile flies to the cell of the target
//    image whose colour it matches best, and the target picture appears.

export type FlySide = 'random' | 'left' | 'right' | 'top' | 'bottom';

export type WallPhoto = {id: string; thumb: string; full?: string; name?: string | null; message?: string | null};

type RGB = [number, number, number];
type Rect = {x: number; y: number; s: number};
type Tween = {from: Rect & {r: number}; to: Rect; t0: number; dur: number; delay: number; arc: number; spin: number};

type Tile = {
  id: string;
  img: CanvasImageSource | null;
  fullImg: CanvasImageSource | null;
  fullUrl?: string;
  fullLoading?: boolean;
  color: RGB | null;
  pos: Rect & {r: number};
  tween: Tween | null;
  alpha: number;
  pop: number; // landing bounce start time
  placed: boolean;
  cell: number; // mosaic cell index
};

type Flight = {tile: Tile; t0: number; dur: number; pts: {x: number; y: number}[]; s0: number; photo: WallPhoto};
type Particle = {x: number; y: number; vx: number; vy: number; life: number; t0: number; color: string; size: number; spin: number; shape: 0 | 1};

export type EngineCallbacks = {
  onCount?: (placed: number) => void;
  onPhase?: (phase: 'gallery' | 'revealing' | 'mosaic') => void;
  onFlight?: (photo: WallPhoto | null) => void;
};

const PALETTE = ['#ff3d8b', '#ffb000', '#00d1ff', '#8a2be2', '#35e0a1', '#ff6a3d', '#ffffff'];
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function averageColor(img: CanvasImageSource): RGB {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const x = c.getContext('2d', {willReadFrequently: true})!;
  x.drawImage(img, 0, 0, 12, 12);
  const d = x.getImageData(0, 0, 12, 12).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return [r / n, g / n, b / n];
}

/** Perceptual-ish RGB distance ("redmean"). */
function dist(a: RGB, b: RGB) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Catmull–Rom through points, t in [0,1]. */
function spline(pts: {x: number; y: number}[], t: number) {
  const n = pts.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const u2 = u * u, u3 = u2 * u;
  const k = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return {x: k(p0.x, p1.x, p2.x, p3.x), y: k(p0.y, p1.y, p2.y, p3.y)};
}

export class WallEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private tiles: Tile[] = []; // arrival order
  private byId = new Map<string, Tile>();
  private queue: WallPhoto[] = [];
  private flights: Flight[] = [];
  private particles: Particle[] = [];
  private lastLaunch = 0;
  private phase: 'gallery' | 'revealing' | 'mosaic' = 'gallery';
  private target: HTMLImageElement | null = null;
  private targetUrl = '';
  private cellColors: RGB[] = [];
  private grid = {cols: 0, rows: 0};
  private cellOwner: (Tile | null)[] = [];
  private overlay = 0; // target overlay strength (animated)
  private overlayGoal = 0;
  private revealAt = 0;
  private dirty = true;
  private destroyed = false;
  private area = {x: 0, y: 0, w: 0, h: 0};
  private flyFrom: FlySide = 'random';

  constructor(private canvas: HTMLCanvasElement, private goal: number, private cb: EngineCallbacks = {}, private speed = 1) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
  }

  setGoal(goal: number) {
    this.goal = Math.max(2, goal);
    if (this.phase === 'gallery' && this.placedCount() >= this.goal) this.startReveal();
  }
  setSpeed(s: number) { this.speed = clamp(s, 0.25, 4); }
  /** Which screen edge new photos fly in from. */
  setFlyFrom(side: string) { this.flyFrom = (['left', 'right', 'top', 'bottom'].includes(side) ? side : 'random') as FlySide; }

  async setTarget(url: string) {
    if (url === this.targetUrl) return;
    this.targetUrl = url;
    try {
      this.target = await loadImage(url);
      this.buildGrid();
      if (this.phase !== 'gallery') this.assignMosaic(true);
      this.dirty = true;
    } catch {
      this.target = null;
    }
  }

  /** Where tiles may go: between the header and the footer bands. */
  setArea(top: number, bottom: number) {
    const padX = Math.max(24, this.w * 0.03);
    this.area = {x: padX, y: top, w: this.w - padX * 2, h: Math.max(100, this.h - top - bottom)};
    this.relayout(false);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.area.w) this.area = {x: 24, y: this.h * 0.14, w: this.w - 48, h: this.h * 0.72};
    this.relayout(false);
    this.dirty = true;
  }

  /** Reconcile with the server's current list (arrival order). New ids queue for a flight. */
  sync(photos: WallPhoto[], animate: boolean) {
    const ids = new Set(photos.map((p) => p.id));
    // Removed (rejected) photos fade out.
    for (const t of [...this.tiles]) if (!ids.has(t.id)) this.remove(t.id);
    this.queue = this.queue.filter((q) => ids.has(q.id));
    for (const p of photos) {
      if (this.byId.has(p.id) || this.queue.some((q) => q.id === p.id) || this.flights.some((f) => f.photo.id === p.id)) continue;
      if (animate) this.queue.push(p);
      else this.addInstant(p);
    }
    this.dirty = true;
  }

  /** Force the big-picture moment now (admin "play reveal"). */
  reveal() { if (this.phase === 'gallery' && this.tiles.length) this.startReveal(); }

  placedCount() { return this.tiles.filter((t) => t.placed).length; }

  // ——— tiles ———

  private newTile(p: WallPhoto): Tile {
    const t: Tile = {id: p.id, img: null, fullImg: null, color: null, pos: {x: this.w / 2, y: this.h / 2, s: 0, r: 0}, tween: null, alpha: 1, pop: 0, placed: false, cell: -1};
    loadImage(p.thumb).then((img) => { t.img = img; t.color = averageColor(img); this.dirty = true; if (this.phase === 'mosaic') this.assignLate(t); }).catch(() => {});
    t.fullUrl = p.full;
    return t;
  }

  /** One shared check (not a timer per photo): sharp images while tiles are big, max 6 loading at once. */
  private lastUpgrade = 0;
  private upgrade(now: number) {
    if (now - this.lastUpgrade < 1500) return;
    this.lastUpgrade = now;
    if (this.tileSize() * this.dpr <= 230) return;
    let loading = this.tiles.filter((t) => t.fullLoading).length;
    for (const t of this.tiles) {
      if (loading >= 6) break;
      if (t.fullImg || t.fullLoading || !t.fullUrl) continue;
      t.fullLoading = true;
      loading++;
      loadImage(t.fullUrl).then((img) => { t.fullImg = img; this.dirty = true; }).catch(() => {}).finally(() => { t.fullLoading = false; if (!t.fullImg) t.fullUrl = undefined; });
    }
  }

  private addInstant(p: WallPhoto) {
    const t = this.newTile(p);
    t.placed = true;
    this.tiles.push(t);
    this.byId.set(t.id, t);
    const slot = this.slotFor(this.tiles.length - 1);
    t.pos = {...slot, r: 0, s: 0};
    t.tween = {from: {...slot, s: 0, r: 0}, to: slot, t0: performance.now(), dur: 500, delay: Math.min(1500, this.tiles.length * 12), arc: 0, spin: 0};
    this.relayout(true);
    this.cb.onCount?.(this.placedCount());
    if (this.phase === 'gallery' && this.placedCount() >= this.goal) this.scheduleReveal(900);
    else if (this.phase === 'mosaic') this.assignLate(t);
  }

  private remove(id: string) {
    const t = this.byId.get(id);
    if (!t) return;
    this.byId.delete(id);
    this.tiles = this.tiles.filter((x) => x !== t);
    if (this.phase !== 'gallery') {
      const cells = this.cellOwner.map((o, i) => (o === t ? i : -1)).filter((i) => i >= 0);
      for (const c of cells) this.cellOwner[c] = null;
      this.fillEmptyCells();
    }
    this.relayout(true);
    this.cb.onCount?.(this.placedCount());
  }

  // ——— layout ———

  /** Best square tile size for n tiles in the area, capped so a handful of photos isn't huge. */
  private galleryGrid(n: number) {
    const {w, h} = this.area;
    let best = {cols: 1, rows: 1, s: 0};
    for (let c = 1; c <= Math.max(1, n); c++) {
      const r = Math.ceil(n / c);
      const s = Math.min(w / c, h / r);
      if (s > best.s) best = {cols: c, rows: r, s};
    }
    const cap = Math.min(h / 2.3, w / 4.2); // ~10 photos → comfortable "print" size
    best.s = Math.min(best.s, cap);
    return best;
  }

  private tileSize() {
    if (this.phase !== 'gallery' && this.grid.cols) return this.cellRect(0).s;
    return this.galleryGrid(Math.max(1, this.tiles.length)).s;
  }

  private slotFor(i: number, n = this.tiles.length): Rect {
    const g = this.galleryGrid(Math.max(1, n));
    const col = i % g.cols;
    const row = Math.floor(i / g.cols);
    const rowCount = row === g.rows - 1 ? n - row * g.cols : g.cols; // centre a short last row
    const gridW = g.cols * g.s, gridH = g.rows * g.s;
    const x0 = this.area.x + (this.area.w - gridW) / 2 + ((g.cols - rowCount) * g.s) / 2;
    const y0 = this.area.y + (this.area.h - gridH) / 2;
    return {x: x0 + col * g.s + g.s / 2, y: y0 + row * g.s + g.s / 2, s: g.s};
  }

  private cellRect(i: number): Rect {
    const {cols, rows} = this.grid;
    const s = Math.min(this.area.w / cols, this.area.h / rows);
    const x0 = this.area.x + (this.area.w - cols * s) / 2;
    const y0 = this.area.y + (this.area.h - rows * s) / 2;
    return {x: x0 + (i % cols) * s + s / 2, y: y0 + Math.floor(i / cols) * s + s / 2, s};
  }

  private mosaicBounds() {
    const a = this.cellRect(0), s = a.s;
    return {x: a.x - s / 2, y: a.y - s / 2, w: this.grid.cols * s, h: this.grid.rows * s};
  }

  /** Move every placed tile to where it belongs now (gallery slot or mosaic cell). */
  private relayout(animate: boolean) {
    const now = performance.now();
    const placed = this.tiles.filter((t) => t.placed);
    const n = placed.length + this.flights.length; // leave room for incoming photos
    placed.forEach((t, i) => {
      const to = this.phase === 'gallery' ? this.slotFor(i, n) : t.cell >= 0 ? this.cellRect(t.cell) : null;
      if (!to) return;
      if (!animate) { t.pos = {...to, r: 0}; t.tween = null; return; }
      const cur = this.current(t, now);
      if (Math.abs(cur.x - to.x) + Math.abs(cur.y - to.y) + Math.abs(cur.s - to.s) < 0.5) return;
      t.tween = {from: cur, to, t0: now, dur: 750 / this.speed, delay: 0, arc: 0, spin: 0};
    });
    this.dirty = true;
  }

  private current(t: Tile, now: number): Rect & {r: number} {
    const tw = t.tween;
    if (!tw) return t.pos;
    const raw = (now - tw.t0 - tw.delay) / tw.dur;
    if (raw <= 0) return tw.from;
    if (raw >= 1) { t.pos = {...tw.to, r: 0}; t.tween = null; return t.pos; }
    const e = easeInOut(raw);
    const x = tw.from.x + (tw.to.x - tw.from.x) * e;
    const y = tw.from.y + (tw.to.y - tw.from.y) * e - Math.sin(Math.PI * e) * tw.arc;
    const s = tw.from.s + (tw.to.s - tw.from.s) * e;
    const r = tw.from.r * (1 - e) + Math.sin(Math.PI * e) * tw.spin;
    return {x, y, s, r};
  }

  // ——— arrivals ———

  private launch(now: number) {
    if (this.phase === 'revealing' || !this.queue.length) return;
    const backlog = this.queue.length;
    // Busy moments speed up; a flood skips the flight so nobody waits long.
    if (backlog > 40) { while (this.queue.length > 8) this.addInstant(this.queue.shift()!); return; }
    const gap = (backlog > 10 ? 250 : backlog > 3 ? 600 : 1100) / this.speed;
    if (now - this.lastLaunch < gap || this.flights.length >= 5) return;
    this.lastLaunch = now;
    const photo = this.queue.shift()!;
    const tile = this.newTile(photo);
    const dur = (backlog > 10 ? 1900 : backlog > 3 ? 2600 : 3300) / this.speed;
    // Start just off a random edge, loop over the wall twice, then home in.
    const sides: FlySide[] = ['left', 'right', 'top', 'bottom'];
    const edge = this.flyFrom === 'random' ? Math.floor(Math.random() * 4) : sides.indexOf(this.flyFrom);
    const rx = Math.random(), ry = Math.random();
    const start = edge === 0 ? {x: -120, y: this.h * (0.2 + ry * 0.6)} : edge === 1 ? {x: this.w + 120, y: this.h * (0.2 + ry * 0.6)}
      : edge === 2 ? {x: this.w * (0.15 + rx * 0.7), y: -140} : {x: this.w * (0.15 + rx * 0.7), y: this.h + 140};
    const a = this.area;
    const w1 = {x: a.x + a.w * (0.2 + Math.random() * 0.6), y: a.y + a.h * (0.15 + Math.random() * 0.3)};
    const w2 = {x: a.x + a.w * (0.2 + Math.random() * 0.6), y: a.y + a.h * (0.55 + Math.random() * 0.3)};
    const s0 = Math.min(this.h * 0.3, 340);
    const f: Flight = {tile, t0: now, dur, pts: [start, w1, w2, {x: 0, y: 0}], s0, photo};
    this.flights.push(f);
    this.byId.set(tile.id, tile);
    if (photo.full) loadImage(photo.full).then((img) => { tile.fullImg = img; }).catch(() => {});
    this.relayout(true); // others make room now
    if (this.flights.length === 1) this.cb.onFlight?.(photo);
  }

  private flightTarget(f: Flight): Rect {
    if (this.phase === 'gallery') {
      const placed = this.tiles.filter((t) => t.placed).length;
      const idx = placed + this.flights.indexOf(f);
      return this.slotFor(idx, placed + this.flights.length);
    }
    if (f.tile.cell < 0) this.chooseCellFor(f.tile);
    return this.cellRect(Math.max(0, f.tile.cell));
  }

  private land(f: Flight, now: number) {
    const t = f.tile;
    const to = this.flightTarget(f);
    t.placed = true;
    t.pos = {...to, r: 0};
    t.pop = now;
    this.tiles.push(t);
    this.flights = this.flights.filter((x) => x !== f);
    this.burst(to.x, to.y, to.s, 22);
    if (this.phase === 'mosaic' && t.cell >= 0) {
      const prev = this.cellOwner[t.cell];
      this.cellOwner[t.cell] = t;
      if (prev && prev !== t && !this.cellOwner.includes(prev)) prev.cell = -1;
    }
    this.cb.onFlight?.(this.flights[0]?.photo ?? null);
    this.cb.onCount?.(this.placedCount());
    this.relayout(true);
    if (this.phase === 'gallery' && this.placedCount() >= this.goal && !this.flights.length) this.scheduleReveal(1300);
  }

  private burst(x: number, y: number, s: number, n: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const v = (0.25 + Math.random() * 0.55) * Math.max(40, s) / 60;
      this.particles.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 700 + Math.random() * 500, t0: now,
        color: PALETTE[i % PALETTE.length], size: 3 + Math.random() * 5, spin: Math.random() * 6, shape: (i % 2) as 0 | 1});
    }
  }

  // ——— the big picture ———

  private buildGrid() {
    if (!this.target) return;
    const aspect = (this.target.naturalWidth || 16) / (this.target.naturalHeight || 9);
    const cells = Math.max(this.goal, this.tiles.length);
    const cols = Math.max(2, Math.round(Math.sqrt(cells * aspect)));
    const rows = Math.max(2, Math.round(cells / cols));
    this.grid = {cols, rows};
    // Average colour of each cell (4×4 samples per cell).
    const c = document.createElement('canvas');
    c.width = cols * 4;
    c.height = rows * 4;
    const x = c.getContext('2d', {willReadFrequently: true})!;
    x.drawImage(this.target, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    this.cellColors = [];
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      let R = 0, G = 0, B = 0;
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
        const k = ((r * 4 + yy) * c.width + (q * 4 + xx)) * 4;
        R += d[k]; G += d[k + 1]; B += d[k + 2];
      }
      this.cellColors.push([R / 16, G / 16, B / 16]);
    }
    this.cellOwner = new Array(cols * rows).fill(null);
  }

  /**
   * Brightness-rank matching: the brightest photos go to the brightest cells (the logo's
   * letters), the darkest to the background, so the picture forms from the photos
   * themselves. Within each small brightness band, photos are then matched by colour.
   */
  private assignMosaic(animate: boolean) {
    if (!this.target || !this.cellColors.length) return;
    const tiles = this.tiles.filter((t) => t.placed);
    const cells = this.cellColors.length;
    const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const col = (t: Tile): RGB => t.color ?? [128, 128, 128];
    const T = [...tiles].sort((a, b) => lum(col(a)) - lum(col(b)));
    const C = [...Array(cells).keys()].sort((a, b) => lum(this.cellColors[a]) - lum(this.cellColors[b]));
    this.cellOwner = new Array(cells).fill(null);
    tiles.forEach((t) => (t.cell = -1));
    if (!T.length) return;
    // Cell rank j is served by photo rank floor(j·T/C): every photo used, extra cells get a neighbour's duplicate.
    const BAND = 10;
    for (let b = 0; b < cells; b += BAND) {
      const bandCells = C.slice(b, b + BAND);
      const bandPhotos = [...new Set(bandCells.map((_, k) => T[Math.min(T.length - 1, Math.floor(((b + k) * T.length) / cells))]))];
      const pairs: [number, Tile, number][] = [];
      for (const t of bandPhotos) for (const c of bandCells) pairs.push([dist(col(t), this.cellColors[c]), t, c]);
      pairs.sort((x, y) => x[0] - y[0]);
      const usedT = new Set<Tile>(), usedC = new Set<number>();
      for (const [, t, c] of pairs) {
        if (usedT.has(t) || usedC.has(c) || t.cell >= 0) continue;
        usedT.add(t); usedC.add(c);
        t.cell = c;
        this.cellOwner[c] = t;
      }
      // Remaining cells in the band: the band photo that fits best (a duplicate).
      for (const c of bandCells) {
        if (this.cellOwner[c]) continue;
        let best = bandPhotos[0], bd = Infinity;
        for (const t of bandPhotos) { const d = dist(col(t), this.cellColors[c]); if (d < bd) { bd = d; best = t; } }
        this.cellOwner[c] = best;
      }
    }
    // Any photo that ended without its own cell takes over one of its duplicates.
    for (const t of tiles) {
      if (t.cell >= 0) continue;
      const c = this.cellOwner.findIndex((o) => o === t);
      if (c >= 0) t.cell = c;
    }
    this.fillEmptyCells();
    const now = performance.now();
    if (animate) {
      // Tiles from the centre outward, each on a small arc with a spin.
      const cx = this.area.x + this.area.w / 2, cy = this.area.y + this.area.h / 2;
      const maxD = Math.hypot(this.area.w, this.area.h) / 2;
      for (const t of tiles) {
        if (t.cell < 0) continue;
        const to = this.cellRect(t.cell);
        const d = Math.hypot(to.x - cx, to.y - cy) / maxD;
        t.tween = {from: this.current(t, now), to, t0: now, dur: 1500 / this.speed, delay: (d * 1600 + Math.random() * 300) / this.speed,
          arc: 40 + Math.random() * 80, spin: (Math.random() - 0.5) * 1.6};
      }
    } else this.relayout(false);
  }

  /** Cells without a unique photo get the best-matching photo again (so the picture is complete). */
  private fillEmptyCells() {
    const tiles = this.tiles.filter((t) => t.placed && t.color);
    if (!tiles.length) return;
    this.cellOwner = this.cellOwner.map((o, c) => {
      if (o && this.byId.has(o.id)) return o;
      let best = tiles[0], bd = Infinity;
      for (const t of tiles) { const d = dist(t.color!, this.cellColors[c]); if (d < bd) { bd = d; best = t; } }
      return best;
    });
  }

  /** After the reveal, a new photo takes the duplicate cell it fits best (or the worst-fitting cell). */
  private chooseCellFor(t: Tile) {
    const col = t.color ?? [128, 128, 128];
    let best = -1, bestScore = Infinity;
    const counts = new Map<Tile, number>();
    for (const o of this.cellOwner) if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    this.cellOwner.forEach((o, c) => {
      const dup = o && (counts.get(o) ?? 0) > 1 && o.cell !== c;
      const current = o?.color ? dist(o.color, this.cellColors[c]) : 999;
      const mine = dist(col, this.cellColors[c]);
      const score = dup ? mine - 1000 : mine - current; // prefer duplicates, then biggest improvement
      if (score < bestScore) { bestScore = score; best = c; }
    });
    t.cell = best;
  }

  private assignLate(t: Tile) {
    if (t.placed && t.cell < 0 && this.phase === 'mosaic') {
      this.chooseCellFor(t);
      if (t.cell >= 0) { this.cellOwner[t.cell] = t; this.relayout(true); }
    }
  }

  private scheduleReveal(ms: number) {
    if (this.revealAt || this.phase !== 'gallery') return;
    this.revealAt = performance.now() + ms;
  }

  private startReveal() {
    if (!this.target) { this.revealAt = performance.now() + 500; return; } // wait for the target image
    this.revealAt = 0;
    this.phase = 'revealing';
    this.cb.onPhase?.('revealing');
    this.buildGrid();
    this.assignMosaic(true);
    const total = (1600 + 1500 + 400) / this.speed;
    setTimeout(() => {
      if (this.destroyed) return;
      this.phase = 'mosaic';
      this.overlayGoal = 0.5;
      const b = this.mosaicBounds();
      for (let i = 0; i < 6; i++) setTimeout(() => this.burst(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 160, 40), i * 180);
      this.cb.onPhase?.('mosaic');
    }, total);
  }

  // ——— drawing ———

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.revealAt && now >= this.revealAt) this.startReveal();
    this.launch(now);
    this.upgrade(now);
    const active = this.flights.length || this.particles.length || this.tiles.some((t) => t.tween || now - t.pop < 500) || Math.abs(this.overlay - this.overlayGoal) > 0.002;
    if (!active && !this.dirty) return;
    this.dirty = false;
    this.overlay += (this.overlayGoal - this.overlay) * 0.04;
    this.draw(now);
  };

  private draw(now: number) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const mosaic = this.phase !== 'gallery';

    if (mosaic) {
      // Each cell shows its owner (duplicates included), edge to edge; a cell waits until its photo has landed.
      this.cellOwner.forEach((o, i) => {
        if (!o || o.tween) return;
        const r = this.cellRect(i);
        this.drawImageCell(o, r.x, r.y, r.s, 0, 1, true);
      });
      for (const t of this.tiles) if (t.tween && t.cell >= 0) { const p = this.current(t, now); this.drawImageCell(t, p.x, p.y, p.s, p.r, 1, true); }
      if (this.target && this.overlay > 0.01) {
        const b = this.mosaicBounds();
        c.save();
        c.globalAlpha = this.overlay;
        c.drawImage(this.target, b.x, b.y, b.w, b.h);
        c.restore();
      }
    } else {
      for (const t of this.tiles) {
        if (!t.placed) continue;
        const p = this.current(t, now);
        const popT = (now - t.pop) / 500;
        const bounce = popT >= 0 && popT < 1 ? 1 + Math.sin(popT * Math.PI) * 0.14 * (1 - popT) : 1;
        this.drawImageCell(t, p.x, p.y, p.s * bounce, p.r, t.alpha, mosaic || this.phase === 'revealing');
      }
    }

    // Flights on top: a colourful comet trail, then the framed photo.
    for (const f of this.flights) {
      const raw = (now - f.t0) / f.dur;
      const to = this.flightTarget(f);
      f.pts[f.pts.length - 1] = {x: to.x, y: to.y};
      if (raw >= 1) { this.land(f, now); continue; }
      const e = easeInOut(raw);
      for (let k = 10; k >= 1; k--) {
        const q = spline(f.pts, Math.max(0, e - k * 0.012));
        c.globalAlpha = (1 - k / 11) * 0.55;
        c.fillStyle = PALETTE[k % 5];
        c.beginPath();
        c.arc(q.x, q.y, Math.max(3, (f.s0 * 0.09) * (1 - k / 12)), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      const p = spline(f.pts, e);
      const shrink = raw < 0.62 ? 0 : easeOut((raw - 0.62) / 0.38);
      const s = f.s0 + (to.s - f.s0) * shrink;
      const rot = Math.sin(raw * Math.PI * 3) * 0.18 * (1 - shrink);
      this.drawImageCell(f.tile, p.x, p.y, s, rot, 1, false, true);
    }

    // Confetti.
    this.particles = this.particles.filter((q) => now - q.t0 < q.life);
    for (const q of this.particles) {
      const age = now - q.t0;
      const k = age / q.life;
      const x = q.x + q.vx * age * 0.25;
      const y = q.y + q.vy * age * 0.25 + age * age * 0.00012;
      c.save();
      c.globalAlpha = 1 - k;
      c.translate(x, y);
      c.rotate(q.spin * k * 3);
      c.fillStyle = q.color;
      if (q.shape) c.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
      else { c.beginPath(); c.arc(0, 0, q.size / 2, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
  }

  /** framed = white print border + shadow (gallery / flights); plain = edge-to-edge mosaic cell. */
  private drawImageCell(t: Tile, x: number, y: number, s: number, rot: number, alpha: number, plain: boolean, lifted = false) {
    const c = this.ctx;
    const img = (s * this.dpr > 200 && t.fullImg) || t.img || t.fullImg;
    if (s < 0.5) return;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    if (rot) c.rotate(rot);
    const h = s / 2;
    if (plain) {
      if (img) this.cover(img, -h, -h, s, s);
      else { c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(-h, -h, s, s); }
      c.restore();
      return;
    }
    const gap = Math.max(2, s * 0.045);
    const frame = Math.max(2, s * 0.035);
    const rr = Math.max(3, s * 0.06);
    const outer = s - gap * 2;
    c.shadowColor = lifted ? 'rgba(20,0,40,.55)' : 'rgba(20,0,40,.35)';
    c.shadowBlur = lifted ? 30 : Math.min(18, s * 0.08);
    c.shadowOffsetY = lifted ? 14 : Math.min(6, s * 0.03);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.roundRect(-outer / 2, -outer / 2, outer, outer, rr);
    c.fill();
    c.shadowColor = 'transparent';
    const inner = outer - frame * 2;
    c.beginPath();
    c.roundRect(-inner / 2, -inner / 2, inner, inner, Math.max(2, rr - frame));
    c.clip();
    if (img) this.cover(img, -inner / 2, -inner / 2, inner, inner);
    else { c.fillStyle = '#e9e3f5'; c.fillRect(-inner / 2, -inner / 2, inner, inner); }
    c.restore();
  }

  private cover(img: CanvasImageSource, x: number, y: number, w: number, h: number) {
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
    if (!iw || !ih) return;
    const side = Math.min(iw, ih);
    this.ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, x, y, w, h);
  }
}
