import { parseCatalog, type Catalog, type CatalogEntry, type CatalogResult } from './catalog';
import { defaultStyle, validateGeoJSON } from './geojson';
import type { Bbox, DatasetContent } from './storage';

export type SampleLoadPayload = {
  filename: string;
  bounds: Bbox;
  catalogId: string;
  title: string;
  description?: string;
  content: DatasetContent;
};

function datasetUrl(file: string): string {
  return `/datasets/${file}`;
}

export async function fetchStaticCatalog(): Promise<CatalogResult<Catalog>> {
  try {
    const response = await fetch('/datasets/catalog.json', { cache: 'no-cache' });
    if (!response.ok) return { ok: false, error: `sample catalog fetch failed (${response.status} ${response.statusText})` };
    return parseCatalog(await response.json());
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function loadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image sample failed to load'));
    image.src = src;
  });
}

export function loadVideo(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('video sample failed to load'));
    video.src = src;
    video.load();
  });
}

function baseSample(entry: CatalogEntry) {
  return {
    filename: entry.file,
    bounds: entry.bounds,
    catalogId: entry.id,
    title: entry.title,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  };
}

export async function loadStaticSample(entry: CatalogEntry): Promise<
  | { ok: true; payload: SampleLoadPayload }
  | { ok: false; error: string }
> {
  const src = datasetUrl(entry.file);
  if (entry.kind === 'geojson') {
    const response = await fetch(src, { cache: 'no-cache' });
    if (!response.ok) return { ok: false, error: `sample fetch failed (${response.status} ${response.statusText})` };
    const result = validateGeoJSON(await response.text());
    if (!result.ok) return result;
    return {
      ok: true,
      payload: {
        ...baseSample(entry),
        content: { kind: 'geojson', geojson: result.value, style: defaultStyle() },
      },
    };
  }

  if (entry.kind === 'image') {
    await loadImage(src);
    return { ok: true, payload: { ...baseSample(entry), content: { kind: 'image', src, mediaType: 'image/png' } } };
  }

  await loadVideo(src);
  return {
    ok: true,
    payload: {
      ...baseSample(entry),
      content: { kind: 'video', src, mediaType: 'video/mp4', muted: true, autoplay: true, loop: true },
    },
  };
}
