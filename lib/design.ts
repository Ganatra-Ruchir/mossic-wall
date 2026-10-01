// Wall design settings, edited in Admin → Design. Stored per event as JSON.
// normalizeDesign() is used by the server (to validate) and the browser (to fill defaults).

export type Arrival = 'loop' | 'direct' | 'pop';
export type FlySide = 'random' | 'left' | 'right' | 'top' | 'bottom';

export type Design = {
  // Background
  background: string;      // base colour behind everything
  glows: boolean;          // drifting colour glows
  glowStrength: number;    // 0–100 %
  accent: string;          // progress bar, guest-page buttons
  // Photos while the wall is filling
  frame: boolean;          // white "print" border
  frameColor: string;
  frameWidth: number;      // 0–12 % of the photo
  corner: number;          // 0–50 % roundness
  shadow: boolean;
  tilt: boolean;           // each photo slightly angled, like pinned prints
  photoSize: number;       // 50–150 %
  gap: number;             // 0–25 % space between photos
  // The big picture
  mosaicGap: number;       // 0–10 % space between tiles in the final picture
  mosaicFill: number;      // 60–100 % of the screen the final picture fills
  pictureStrength: number; // 0–90 % how strongly the target image shows over the photos
  // Animation
  speed: number;           // 0.5–3 ×
  arrival: Arrival;        // loop across the wall, fly straight in, or pop in place
  flyFrom: FlySide;
  confetti: boolean;
  // Screen elements
  showTitle: boolean;
  tagline: string;         // empty = default tagline
  showQr: boolean;
  showCounter: boolean;
  showCaptions: boolean;   // "Priya joined the picture"
  // Extras
  spotlight: boolean;      // show a random photo large when no new photos arrive for a while
  milestones: boolean;     // banner + confetti at 25 %, 50 %, 75 % of the goal
  tour: boolean;           // slow close-up zooms over the finished picture
};

export const DEFAULT_DESIGN: Design = {
  background: '#1d0633', glows: true, glowStrength: 70, accent: '#ff3d8b',
  frame: true, frameColor: '#ffffff', frameWidth: 4, corner: 6, shadow: true, tilt: false, photoSize: 100, gap: 9,
  mosaicGap: 0, mosaicFill: 100, pictureStrength: 50,
  speed: 1, arrival: 'loop', flyFrom: 'random', confetti: true,
  showTitle: true, tagline: '', showQr: true, showCounter: true, showCaptions: true,
  spotlight: true, milestones: true, tour: true,
};

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Fill defaults and clamp every value to its allowed range (unknown keys are dropped). */
export function normalizeDesign(input: unknown, legacy?: {fly_from?: string | null; animation_speed?: number | string | null}): Design {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const D = DEFAULT_DESIGN;
  return {
    background: color(i.background, D.background),
    glows: bool(i.glows, D.glows),
    glowStrength: num(i.glowStrength, 0, 100, D.glowStrength),
    accent: color(i.accent, D.accent),
    frame: bool(i.frame, D.frame),
    frameColor: color(i.frameColor, D.frameColor),
    frameWidth: num(i.frameWidth, 0, 12, D.frameWidth),
    corner: num(i.corner, 0, 50, D.corner),
    shadow: bool(i.shadow, D.shadow),
    tilt: bool(i.tilt, D.tilt),
    photoSize: num(i.photoSize, 50, 150, D.photoSize),
    gap: num(i.gap, 0, 25, D.gap),
    mosaicGap: num(i.mosaicGap, 0, 10, D.mosaicGap),
    mosaicFill: num(i.mosaicFill, 60, 100, D.mosaicFill),
    pictureStrength: num(i.pictureStrength, 0, 90, D.pictureStrength),
    speed: num(i.speed ?? legacy?.animation_speed, 0.5, 3, D.speed),
    arrival: pick(i.arrival, ['loop', 'direct', 'pop'] as const, D.arrival),
    flyFrom: pick(i.flyFrom ?? legacy?.fly_from, ['random', 'left', 'right', 'top', 'bottom'] as const, D.flyFrom),
    confetti: bool(i.confetti, D.confetti),
    showTitle: bool(i.showTitle, D.showTitle),
    tagline: typeof i.tagline === 'string' ? i.tagline.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : D.tagline,
    showQr: bool(i.showQr, D.showQr),
    showCounter: bool(i.showCounter, D.showCounter),
    showCaptions: bool(i.showCaptions, D.showCaptions),
    spotlight: bool(i.spotlight, D.spotlight),
    milestones: bool(i.milestones, D.milestones),
    tour: bool(i.tour, D.tour),
  };
}
