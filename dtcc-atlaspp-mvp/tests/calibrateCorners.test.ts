import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalibrateCorners from '../src/lib/CalibrateCorners.svelte';
import type { Dataset } from '../src/lib/storage';

const dataset: Dataset = {
  version: 3,
  filename: 'test.geojson',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  bounds: [0, 0, 1, 1],
  content: {
    kind: 'geojson',
    geojson: { type: 'FeatureCollection', features: [] },
    style: { color: '#ff0000' },
  },
};

function mountCorners(extraProps: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onCornersChange = vi.fn();
  const component = mount(CalibrateCorners, {
    target,
    props: { dataset, panX: 0, panY: 0, onCornersChange, ...extraProps },
  });
  return { target, component, onCornersChange };
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await tick();
}

function handles(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('[aria-label^="Calibration corner"]'),
  ).sort((a, b) => a.getAttribute('aria-label')!.localeCompare(b.getAttribute('aria-label')!));
}

type Pt = { x: number; y: number };

function positionOf(el: HTMLButtonElement): Pt {
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
}

const HANDLE_SIDE = 24; // w-6 h-6, border-box

// The four screen-space corners of a handle's box: anchored at left/top and
// rotated about that anchor by the inline rotate() transform (if any).
function handleBoxCorners(el: HTMLButtonElement): Pt[] {
  const { x, y } = positionOf(el);
  const match = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform);
  const theta = match ? (parseFloat(match[1]) * Math.PI) / 180 : 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const local: Pt[] = [
    { x: 0, y: 0 },
    { x: HANDLE_SIDE, y: 0 },
    { x: HANDLE_SIDE, y: HANDLE_SIDE },
    { x: 0, y: HANDLE_SIDE },
  ];
  return local.map((p) => ({ x: x + p.x * cos - p.y * sin, y: y + p.x * sin + p.y * cos }));
}

// Point-in-convex-polygon for positively wound quads (cross products of each
// edge with the point must not go negative beyond a float tolerance).
function insideConvexQuad(p: Pt, quad: Pt[], eps = 1e-3): boolean {
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross < -eps) return false;
  }
  return true;
}

function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function firePointer(el: Element, type: string, x: number, y: number) {
  const Ctor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  el.dispatchEvent(
    new Ctor(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 } as PointerEventInit),
  );
}

async function drag(el: Element, from: Pt, to: Pt) {
  firePointer(el, 'pointerdown', from.x, from.y);
  firePointer(el, 'pointermove', to.x, to.y);
  firePointer(el, 'pointerup', to.x, to.y);
  await flushEffects();
}

// Drag the default rectangle into a diamond: each corner moves to the
// midpoint of a former edge, producing a 45°-rotated convex quad.
async function dragIntoDiamond(before: Pt[]): Promise<Pt[]> {
  const midX = (before[0].x + before[1].x) / 2;
  const midY = (before[0].y + before[3].y) / 2;
  const diamond: Pt[] = [
    { x: midX, y: before[0].y },
    { x: before[1].x, y: midY },
    { x: midX, y: before[2].y },
    { x: before[0].x, y: midY },
  ];
  for (let i = 0; i < 4; i++) {
    await drag(handles()[i], positionOf(handles()[i]), diamond[i]);
  }
  return diamond;
}

describe('CalibrateCorners', () => {
  let mounted: ReturnType<typeof mountCorners> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    (HTMLElement.prototype as any).setPointerCapture ??= () => {};
    (HTMLElement.prototype as any).releasePointerCapture ??= () => {};
  });

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.component);
      mounted.target.remove();
      mounted = null;
    }
  });

  it('moves only the dragged corner, leaving the other three unchanged', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    const tl = handles()[0];
    await drag(tl, before[0], { x: before[0].x + 50, y: before[0].y + 30 });

    const after = handles().map(positionOf);
    expect(after[0]).toEqual({ x: before[0].x + 50, y: before[0].y + 30 });
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[3]).toEqual(before[3]);
  });

  it('keeps the grab offset while dragging instead of snapping the corner to the pointer', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    // Grab the handle 8px inside its box, then move the pointer by (+50, +30):
    // the corner must move by exactly (+50, +30), not jump onto the pointer.
    const tl = handles()[0];
    await drag(
      tl,
      { x: before[0].x + 8, y: before[0].y + 8 },
      { x: before[0].x + 58, y: before[0].y + 38 },
    );

    const after = handles().map(positionOf);
    expect(after[0]).toEqual({ x: before[0].x + 50, y: before[0].y + 30 });
  });

  it('reports a valid homography mapping the source square onto a rotated quad', async () => {
    mounted = mountCorners();
    await flushEffects();
    // The default handle positions coincide with the homography src square.
    const src = handles().map(positionOf);

    const diamond = await dragIntoDiamond(src);

    const [cornerDst, homography] = mounted.onCornersChange.mock.lastCall!;
    expect(cornerDst).toEqual(diamond.map((p) => [p.x, p.y]));
    expect(homography).toHaveLength(9);
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyH(homography, src[i].x, src[i].y);
      expect(x).toBeCloseTo(diamond[i].x, 4);
      expect(y).toBeCloseTo(diamond[i].y, 4);
    }
  });

  it('reports a null homography and warns when the quad self-intersects', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    // Drag the top-left corner past the top-right and far down: the edges
    // BL→TL and TR→BR now cross, folding the quad into a bow-tie.
    const tl = handles()[0];
    await drag(tl, before[0], { x: before[1].x + 100, y: before[0].y + 300 });

    const lastCall = mounted.onCornersChange.mock.lastCall!;
    expect(lastCall[1]).toBeNull();
    expect(document.body.textContent).toContain('Corners fold');
  });

  it('reports a null homography and warns when the quad is mirrored', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    // Swap TL past TR and BL past BR: the quad is convex again but reverse
    // wound, which would project the dataset mirror-imaged.
    await drag(handles()[0], positionOf(handles()[0]), { x: before[1].x + 50, y: before[0].y });
    await drag(handles()[3], positionOf(handles()[3]), { x: before[2].x + 50, y: before[3].y });

    const lastCall = mounted.onCornersChange.mock.lastCall!;
    expect(lastCall[1]).toBeNull();
    expect(document.body.textContent).toContain('Corners swapped');
  });

  it('recovers from an invalid quad via Reset corners', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    const tl = handles()[0];
    await drag(tl, before[0], { x: before[1].x + 100, y: before[0].y + 300 });
    expect(document.body.textContent).toContain('Corners fold');

    const resetButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reset corners',
    )!;
    resetButton.click();
    await flushEffects();

    expect(handles().map(positionOf)).toEqual(before);
    expect(document.body.textContent).not.toContain('Corners fold');
    expect(mounted.onCornersChange.mock.lastCall![1]).not.toBeNull();
  });

  it('renders square handles fully inside the default calibration rectangle', async () => {
    mounted = mountCorners();
    await flushEffects();

    const quad = handles().map(positionOf);
    for (const button of handles()) {
      expect(button.className).not.toContain('rounded-full');
      for (const corner of handleBoxCorners(button)) {
        expect(insideConvexQuad(corner, quad)).toBe(true);
      }
    }
  });

  it('keeps square handles fully inside a rotated quad', async () => {
    mounted = mountCorners();
    await flushEffects();

    const diamond = await dragIntoDiamond(handles().map(positionOf));

    for (const button of handles()) {
      for (const corner of handleBoxCorners(button)) {
        expect(insideConvexQuad(corner, diamond)).toBe(true);
      }
    }
  });

  it('seeds handles from seedCorners and reports their homography on mount', async () => {
    const seed = [
      { x: 500, y: 100 },
      { x: 800, y: 400 },
      { x: 500, y: 700 },
      { x: 200, y: 400 },
    ];
    mounted = mountCorners({ seedCorners: seed });
    await flushEffects();

    expect(handles().map(positionOf)).toEqual(seed);
    const lastCall = mounted.onCornersChange.mock.lastCall!;
    expect(lastCall[0]).toEqual(seed.map((p) => [p.x, p.y]));
    expect(lastCall[1]).not.toBeNull();
  });

  it('warns immediately when seeded with a self-intersecting quad', async () => {
    const seed = [
      { x: 800, y: 100 },
      { x: 200, y: 100 },
      { x: 800, y: 700 },
      { x: 200, y: 700 },
    ];
    mounted = mountCorners({ seedCorners: seed });
    await flushEffects();

    expect(mounted.onCornersChange.mock.lastCall![1]).toBeNull();
    expect(document.body.textContent).toContain('Corners fold');
  });
});

async function pressKey(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  await flushEffects();
  return event;
}

function selectedIndexFromDom(): number {
  return handles().findIndex((b) => b.getAttribute('aria-pressed') === 'true');
}

function cornerLabels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-corner-label]')).sort(
    (a, b) => a.dataset.cornerLabel!.localeCompare(b.dataset.cornerLabel!),
  );
}

// Each label must sit a fixed margin past its corner, pushed away from the
// quad centroid, so it stays outside the calibration area (issue #12).
function expectLabelsOutsideWithMargin(labels: HTMLElement[], quad: Pt[]) {
  const centroid = {
    x: quad.reduce((s, p) => s + p.x, 0) / 4,
    y: quad.reduce((s, p) => s + p.y, 0) / 4,
  };
  labels.forEach((label, i) => {
    const pos = { x: parseFloat(label.style.left), y: parseFloat(label.style.top) };
    expect(insideConvexQuad(pos, quad)).toBe(false);
    expect(Math.hypot(pos.x - quad[i].x, pos.y - quad[i].y)).toBeCloseTo(28, 4);
    const outward =
      (pos.x - quad[i].x) * (quad[i].x - centroid.x) +
      (pos.y - quad[i].y) * (quad[i].y - centroid.y);
    expect(outward).toBeGreaterThan(0);
  });
}

describe('CalibrateCorners keyboard calibration', () => {
  let mounted: ReturnType<typeof mountCorners> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    (HTMLElement.prototype as any).setPointerCapture ??= () => {};
    (HTMLElement.prototype as any).releasePointerCapture ??= () => {};
  });

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.component);
      mounted.target.remove();
      mounted = null;
    }
  });

  it('selects the first corner by default and highlights it', async () => {
    mounted = mountCorners();
    await flushEffects();
    expect(selectedIndexFromDom()).toBe(0);
    expect(handles()[0].className).toContain('ring-2');
    for (const other of handles().slice(1)) {
      expect(other.className).not.toContain('ring-2');
    }
  });

  it('follows native focus onto a handle (Tab traversal selects corners)', async () => {
    mounted = mountCorners();
    await flushEffects();

    handles()[2].focus();
    await flushEffects();
    expect(selectedIndexFromDom()).toBe(2);

    handles()[1].focus();
    await flushEffects();
    expect(selectedIndexFromDom()).toBe(1);
  });

  it('leaves Tab to native focus traversal instead of swallowing it', async () => {
    mounted = mountCorners();
    await flushEffects();

    const event = await pressKey('Tab');
    expect(event.defaultPrevented).toBe(false);
  });

  it('selects corners directly with the number keys', async () => {
    mounted = mountCorners();
    await flushEffects();

    const event = await pressKey('3');
    expect(selectedIndexFromDom()).toBe(2);
    expect(event.defaultPrevented).toBe(true);
    await pressKey('1');
    expect(selectedIndexFromDom()).toBe(0);
  });

  it('moves the selected corner with arrow keys using the shared step sizes', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    const plain = await pressKey('ArrowRight');
    await pressKey('ArrowDown', { altKey: true });
    await pressKey('ArrowLeft', { shiftKey: true });

    const after = handles().map(positionOf);
    expect(after[0]).toEqual({ x: before[0].x + 10 - 50, y: before[0].y + 1 });
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[3]).toEqual(before[3]);
    // Arrows are consumed so ⌘+Arrow doesn't trigger browser back/forward.
    expect(plain.defaultPrevented).toBe(true);
  });

  it('moves the corner picked by keyboard selection, not the default one', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    await pressKey('2');
    await pressKey('ArrowDown');

    const after = handles().map(positionOf);
    expect(after[1]).toEqual({ x: before[1].x, y: before[1].y + 10 });
    expect(after[0]).toEqual(before[0]);
  });

  it('syncs the selection to the corner grabbed with the pointer and nudges it next', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    const br = handles()[2];
    await drag(br, before[2], { x: before[2].x - 5, y: before[2].y - 5 });
    expect(selectedIndexFromDom()).toBe(2);

    await pressKey('ArrowUp');
    const after = handles().map(positionOf);
    expect(after[2]).toEqual({ x: before[2].x - 5, y: before[2].y - 15 });
    expect(after[0]).toEqual(before[0]);
  });

  it('ignores keyboard input while a pointer drag is active', async () => {
    mounted = mountCorners();
    await flushEffects();
    const initial = handles().map(positionOf);

    // Move away from the default layout first, so a stray reset is visible.
    const tl = handles()[0];
    await drag(tl, initial[0], { x: initial[0].x + 30, y: initial[0].y + 30 });
    const before = handles().map(positionOf);

    firePointer(tl, 'pointerdown', before[0].x, before[0].y);
    await flushEffects();

    await pressKey('ArrowRight');
    expect(handles().map(positionOf)).toEqual(before);
    await pressKey('r');
    expect(handles().map(positionOf)).toEqual(before);

    firePointer(tl, 'pointerup', before[0].x, before[0].y);
    await flushEffects();
  });

  it('resets the corners with the r and R keys', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    await pressKey('ArrowRight');
    expect(handles().map(positionOf)).not.toEqual(before);

    const reset = await pressKey('r');
    expect(handles().map(positionOf)).toEqual(before);
    expect(reset.defaultPrevented).toBe(true);

    await pressKey('ArrowDown');
    await pressKey('R', { shiftKey: true });
    expect(handles().map(positionOf)).toEqual(before);
  });

  it('does not hijack the browser reload shortcut (Cmd/Ctrl+R)', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    await pressKey('ArrowRight');
    const moved = handles().map(positionOf);
    expect(moved).not.toEqual(before);

    const cmdR = await pressKey('r', { metaKey: true });
    expect(handles().map(positionOf)).toEqual(moved);
    expect(cmdR.defaultPrevented).toBe(false);

    const ctrlR = await pressKey('R', { ctrlKey: true });
    expect(handles().map(positionOf)).toEqual(moved);
    expect(ctrlR.defaultPrevented).toBe(false);
  });

  it('recovers from a folded quad via keyboard alone', async () => {
    mounted = mountCorners();
    await flushEffects();
    const before = handles().map(positionOf);

    // Fold: push corner 1 right past corner 2 with coarse steps.
    const stepsOver = Math.ceil((before[1].x - before[0].x) / 50) + 1;
    for (let i = 0; i < stepsOver; i++) await pressKey('ArrowRight', { shiftKey: true });
    expect(document.body.textContent).toContain('Corners fold');
    expect(mounted.onCornersChange.mock.lastCall![1]).toBeNull();

    // Unfold by stepping back left.
    for (let i = 0; i < stepsOver; i++) await pressKey('ArrowLeft', { shiftKey: true });
    expect(document.body.textContent).not.toContain('Corners fold');
    expect(mounted.onCornersChange.mock.lastCall![1]).not.toBeNull();
  });

  it('hides the instructions bar with the hide button and reports it upward', async () => {
    const onBarHiddenChange = vi.fn();
    mounted = mountCorners({ onBarHiddenChange });
    await flushEffects();
    expect(document.body.textContent).toContain('Drag or select a corner');

    (document.querySelector('[aria-label="Hide instructions"]') as HTMLButtonElement).click();
    await flushEffects();

    expect(document.body.textContent).not.toContain('Drag or select a corner');
    expect(onBarHiddenChange).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('[aria-label="Show instructions"]')).not.toBeNull();
  });

  it('restores the instructions bar from the show affordance', async () => {
    const onBarHiddenChange = vi.fn();
    mounted = mountCorners({ barHidden: true, onBarHiddenChange });
    await flushEffects();
    expect(document.body.textContent).not.toContain('Drag or select a corner');
    // No warning pill while the quad is valid, and the chip reveals the
    // keyboard shortcut on hover.
    expect(document.body.textContent).not.toMatch(/Corners|Degenerate/);
    const chip = document.querySelector('[aria-label="Show instructions"]') as HTMLButtonElement;
    expect(chip.getAttribute('title')).toContain('H');

    chip.click();
    await flushEffects();

    expect(document.body.textContent).toContain('Drag or select a corner');
    expect(onBarHiddenChange).toHaveBeenLastCalledWith(false);
  });

  it('toggles the instructions bar with the h key and reports each change', async () => {
    const onBarHiddenChange = vi.fn();
    mounted = mountCorners({ onBarHiddenChange });
    await flushEffects();

    const hide = await pressKey('h');
    expect(document.body.textContent).not.toContain('Drag or select a corner');
    expect(hide.defaultPrevented).toBe(true);
    expect(onBarHiddenChange).toHaveBeenLastCalledWith(true);

    await pressKey('H', { shiftKey: true });
    expect(document.body.textContent).toContain('Drag or select a corner');
    expect(onBarHiddenChange).toHaveBeenLastCalledWith(false);
  });

  it('leaves Cmd/Ctrl+H to the browser', async () => {
    mounted = mountCorners();
    await flushEffects();

    const cmdH = await pressKey('h', { metaKey: true });
    expect(document.body.textContent).toContain('Drag or select a corner');
    expect(cmdH.defaultPrevented).toBe(false);

    const ctrlH = await pressKey('H', { ctrlKey: true });
    expect(document.body.textContent).toContain('Drag or select a corner');
    expect(ctrlH.defaultPrevented).toBe(false);
  });

  it('keeps the validity warning visible with a reset hint while the bar is hidden', async () => {
    mounted = mountCorners({ barHidden: true });
    await flushEffects();
    const before = handles().map(positionOf);

    const tl = handles()[0];
    await drag(tl, before[0], { x: before[1].x + 100, y: before[0].y + 300 });

    expect(document.body.textContent).toContain('Corners fold');
    expect(document.body.textContent).toContain('R resets');
    expect(document.body.textContent).not.toContain('Drag or select a corner');
  });

  it('removes its key listeners on unmount', async () => {
    mounted = mountCorners();
    await flushEffects();
    await unmount(mounted.component);
    mounted.target.remove();
    mounted = null;

    const event = await pressKey('ArrowRight');
    expect(event.defaultPrevented).toBe(false);
  });

  it('renders the corner numbers just outside the calibration area', async () => {
    mounted = mountCorners();
    await flushEffects();

    const quad = handles().map(positionOf);
    const labels = cornerLabels();
    expect(labels.map((l) => l.textContent?.trim())).toEqual(['1', '2', '3', '4']);
    expectLabelsOutsideWithMargin(labels, quad);
  });

  it('keeps the corner numbers outside a rotated quad', async () => {
    mounted = mountCorners();
    await flushEffects();

    const diamond = await dragIntoDiamond(handles().map(positionOf));

    const labels = cornerLabels();
    expect(labels).toHaveLength(4);
    expectLabelsOutsideWithMargin(labels, diamond);
  });
});
