import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStaticCatalog, loadStaticSample } from '../src/lib/sampleCatalog';
import type { CatalogEntry } from '../src/lib/catalog';

const catalog = {
  version: 1,
  entries: [
    {
      id: 'sample-grid',
      title: 'Sample grid',
      description: 'Synthetic grid sample.',
      file: 'sample-grid.geojson',
      kind: 'geojson',
      format: 'geojson',
      bounds: [319900, 6397900, 320000, 6398050],
    },
    {
      id: 'sample-image',
      title: 'Sample image',
      file: 'sample-image.png',
      kind: 'image',
      format: 'png',
      mediaType: 'image/png',
      bounds: [319900, 6397900, 320000, 6398050],
    },
    {
      id: 'sample-video',
      title: 'Sample video',
      file: 'sample-video.mp4',
      kind: 'video',
      format: 'mp4',
      mediaType: 'video/mp4',
      bounds: [319900, 6397900, 320000, 6398050],
    },
  ],
};

const geojsonText = JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'EPSG:3006' } },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [319950, 6398000] },
      properties: {},
    },
  ],
});

class ImageStub {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function stubVideoElement() {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName !== 'video') return originalCreateElement(tagName, options);
    const video: {
      muted: boolean;
      preload: string;
      onloadedmetadata: ((event: Event) => void) | null;
      onerror: (() => void) | null;
      src: string;
      load: () => void;
    } = {
      muted: false,
      preload: '',
      onloadedmetadata: null,
      onerror: null,
      src: '',
      load() {
        queueMicrotask(() => video.onloadedmetadata?.(new Event('loadedmetadata')));
      },
    };
    return video as unknown as HTMLVideoElement;
  });
}

describe('sampleCatalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches and parses the static bundled catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog))));

    const result = await fetchStaticCatalog();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries.map((entry) => entry.id)).toEqual(['sample-grid', 'sample-image', 'sample-video']);
  });

  it('loads GeoJSON static samples into dataset fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/datasets/sample-grid.geojson') return new Response(geojsonText);
      return new Response('missing', { status: 404, statusText: 'Not Found' });
    }));

    const result = await loadStaticSample(catalog.entries[0] as CatalogEntry);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(expect.objectContaining({
        filename: 'sample-grid.geojson',
        catalogId: 'sample-grid',
        title: 'Sample grid',
        description: 'Synthetic grid sample.',
        bounds: [319900, 6397900, 320000, 6398050],
        content: expect.objectContaining({ kind: 'geojson' }),
      }));
    }
  });

  it('loads image and video static samples with stable media payloads', async () => {
    vi.stubGlobal('Image', ImageStub);
    stubVideoElement();

    const image = await loadStaticSample(catalog.entries[1] as CatalogEntry);
    const video = await loadStaticSample(catalog.entries[2] as CatalogEntry);

    expect(image).toEqual({
      ok: true,
      payload: {
        filename: 'sample-image.png',
        bounds: [319900, 6397900, 320000, 6398050],
        catalogId: 'sample-image',
        title: 'Sample image',
        content: { kind: 'image', src: '/datasets/sample-image.png', mediaType: 'image/png' },
      },
    });
    expect(video).toEqual({
      ok: true,
      payload: {
        filename: 'sample-video.mp4',
        bounds: [319900, 6397900, 320000, 6398050],
        catalogId: 'sample-video',
        title: 'Sample video',
        content: { kind: 'video', src: '/datasets/sample-video.mp4', mediaType: 'video/mp4', muted: true, autoplay: true, loop: true },
      },
    });
  });
});
