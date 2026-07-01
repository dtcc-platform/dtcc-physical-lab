import { describe, expect, it } from 'vitest';
import {
  findManifestArtifact,
  isDtccManifestFile,
  parseDtccManifestText,
  resolveDtccManifestFolder,
  resolveDtccManifestFiles,
} from '../src/lib/dtccManifest';

function file(name: string, contents: string, type = ''): File {
  return new File([contents], name, { type });
}

function folderFile(path: string, contents: string, type = ''): File {
  const f = file(path.split('/').pop() ?? path, contents, type);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const smokeStreamlinesManifest = {
  name: 'smoke',
  title: 'Smoke',
  description: 'Synthetic analytical velocity-field simulation.',
  file: 'smoke_streamlines.png',
  format: 'png',
  media_type: 'image/png',
  data_kind: 'raster',
  product: 'streamlines',
  bounds: [319720, 6397660, 320220, 6398160],
  visualization: { profile: 'table', width: 1920, height: 1920 },
};

const smokeSliceManifestV2 = {
  schema_version: 'dtcc-dataset-manifest-v2',
  identity: { name: 'smoke', title: 'Smoke Slice' },
  metadata: { description: 'Synthetic analytical velocity-field simulation.' },
  provenance: {},
  presentation: { summary: 'A projected smoke slice.', view_hints: { profile: 'table', width: 320, height: 180 } },
  request: { dataset_name: 'smoke', parameters: { product: 'slice' }, bounds: [0, 0, 10, 20] },
  artifacts: [
    {
      path: 'artifacts/smoke_slice.vtu',
      role: 'primary',
      format: 'vtu',
      media_type: 'application/vnd.vtk.vtu+xml',
      data_kind: 'mesh',
    },
    {
      path: 'artifacts/smoke_slice.png',
      role: 'primary',
      format: 'png',
      media_type: 'image/png',
      data_kind: 'raster',
      bounds: [1, 2, 3, 4],
    },
    {
      path: 'artifacts/smoke_slice.geojson',
      role: 'auxiliary',
      format: 'geojson',
      media_type: 'application/geo+json',
      data_kind: 'vector',
    },
  ],
};

describe('dtcc manifest input helpers', () => {
  it('parses a dtcc-core PNG manifest for direct wizard loading', () => {
    const result = parseDtccManifestText(
      'smoke_streamlines.manifest.json',
      JSON.stringify(smokeStreamlinesManifest)
    );

    expect(result).toEqual({
      ok: true,
      value: {
        file: 'smoke_streamlines.png',
        artifactName: 'smoke_streamlines.png',
        title: 'Smoke',
        description: 'Synthetic analytical velocity-field simulation.',
        bounds: [319720, 6397660, 320220, 6398160],
        kind: 'image',
        format: 'png',
        mediaType: 'image/png',
        visualization: { profile: 'table', width: 1920, height: 1920 },
      },
    });
  });

  it('matches a parsed manifest to its user-provided artifact file', () => {
    const manifest = parseDtccManifestText(
      'smoke_streamlines.manifest.json',
      JSON.stringify(smokeStreamlinesManifest)
    );
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;

    const artifact = file('smoke_streamlines.png', 'png', 'image/png');
    expect(findManifestArtifact([file('smoke_streamlines.manifest.json', '{}'), artifact], manifest.value)).toBe(
      artifact
    );
  });

  it('matches folder artifacts relative to their manifest directory', () => {
    const nestedManifest = { ...smokeStreamlinesManifest, file: 'media/smoke_streamlines.png' };
    const manifest = parseDtccManifestText('exports/smoke_streamlines.manifest.json', JSON.stringify(nestedManifest));
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;

    const manifestFile = folderFile('exports/smoke_streamlines.manifest.json', JSON.stringify(nestedManifest));
    const wrongArtifact = folderFile('other/media/smoke_streamlines.png', 'png', 'image/png');
    const artifact = folderFile('exports/media/smoke_streamlines.png', 'png', 'image/png');

    expect(findManifestArtifact([wrongArtifact, artifact], manifest.value, manifestFile)).toBe(artifact);
  });

  it('parses Dataset Manifest v2 artifacts and chooses a displayable primary image', () => {
    const result = parseDtccManifestText('manifest.json', JSON.stringify(smokeSliceManifestV2));

    expect(result).toEqual({
      ok: true,
      value: {
        file: 'artifacts/smoke_slice.png',
        artifactName: 'smoke_slice.png',
        title: 'Smoke Slice',
        description: 'Synthetic analytical velocity-field simulation.',
        bounds: [1, 2, 3, 4],
        kind: 'image',
        format: 'png',
        mediaType: 'image/png',
        visualization: { profile: 'table', width: 320, height: 180 },
      },
    });
  });

  it('matches Dataset Manifest v2 package folders by artifact path', () => {
    const manifest = parseDtccManifestText('exports/smoke/manifest.json', JSON.stringify(smokeSliceManifestV2));
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;

    const manifestFile = folderFile('exports/smoke/manifest.json', JSON.stringify(smokeSliceManifestV2));
    const wrongArtifact = folderFile('exports/other/artifacts/smoke_slice.png', 'png', 'image/png');
    const artifact = folderFile('exports/smoke/artifacts/smoke_slice.png', 'png', 'image/png');

    expect(findManifestArtifact([wrongArtifact, artifact], manifest.value, manifestFile)).toBe(artifact);
  });

  it('identifies dtcc-core manifest files by sidecar suffix', () => {
    expect(isDtccManifestFile(file('smoke_streamlines.manifest.json', '{}'))).toBe(true);
    expect(isDtccManifestFile(file('manifest.json', '{}'))).toBe(true);
    expect(isDtccManifestFile(file('plain.geojson', '{}'))).toBe(false);
  });

  it('reports the exact missing artifact for a lone manifest selection', async () => {
    const result = await resolveDtccManifestFiles([
      file('smoke_streamlines.manifest.json', JSON.stringify(smokeStreamlinesManifest)),
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        manifest: {
          file: 'smoke_streamlines.png',
          artifactName: 'smoke_streamlines.png',
          title: 'Smoke',
          description: 'Synthetic analytical velocity-field simulation.',
          bounds: [319720, 6397660, 320220, 6398160],
          kind: 'image',
          format: 'png',
          mediaType: 'image/png',
          visualization: { profile: 'table', width: 1920, height: 1920 },
        },
        artifact: null,
        missingArtifact: 'smoke_streamlines.png',
      },
    });
  });

  it('resolves every supported manifest from a selected folder', async () => {
    const windStreamlinesManifest = {
      ...smokeStreamlinesManifest,
      name: 'wind',
      title: 'Wind',
      file: 'media/wind_streamlines.mp4',
      format: 'mp4',
      media_type: 'video/mp4',
      data_kind: 'video',
      visualization: { profile: 'table', width: 1920, height: 1080, fps: 12, duration: 4 },
    };
    const smokeManifestFile = folderFile(
      'exports/smoke/smoke_streamlines.manifest.json',
      JSON.stringify(smokeStreamlinesManifest)
    );
    const windManifestFile = folderFile(
      'exports/wind/wind_streamlines.manifest.json',
      JSON.stringify(windStreamlinesManifest)
    );
    const smokeArtifact = folderFile('exports/smoke/smoke_streamlines.png', 'png', 'image/png');
    const windArtifact = folderFile('exports/wind/media/wind_streamlines.mp4', 'mp4', 'video/mp4');

    const result = await resolveDtccManifestFolder([
      smokeManifestFile,
      windManifestFile,
      smokeArtifact,
      windArtifact,
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((selection) => selection.manifest.title)).toEqual(['Smoke', 'Wind']);
    expect(result.value.map((selection) => selection.artifact)).toEqual([smokeArtifact, windArtifact]);
  });

  it.each([
    ['unsafe artifact path', { file: '../smoke_streamlines.png' }, /file must be relative/],
    ['Windows-style traversal path', { file: '..\\smoke_streamlines.png' }, /file must be relative/],
    ['Windows drive path', { file: 'C:\\Users\\victim\\secret.png' }, /file must be relative/],
    ['malformed bounds', { bounds: [319720, 6397660, 320220] }, /bounds must be four finite numbers/],
    ['unsupported format', { format: 'vtu', media_type: 'model\/vtu' }, /format vtu is not supported/],
    ['PNG with wrong data_kind', { data_kind: 'video' }, /png manifests must have data_kind raster/],
    ['PNG with wrong media_type', { media_type: 'video\/mp4' }, /png manifests must have media_type image\/png/],
    [
      'MP4 with wrong data_kind',
      { format: 'mp4', file: 'smoke_streamlines.mp4', data_kind: 'raster', media_type: 'video/mp4' },
      /mp4 manifests must have data_kind video/,
    ],
    [
      'MP4 with wrong media_type',
      { format: 'mp4', file: 'smoke_streamlines.mp4', data_kind: 'video', media_type: 'image/png' },
      /mp4 manifests must have media_type video\/mp4/,
    ],
  ])('rejects %s', (_name, overrides, errorPattern) => {
    const result = parseDtccManifestText(
      'smoke_streamlines.manifest.json',
      JSON.stringify({ ...smokeStreamlinesManifest, ...overrides })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(errorPattern);
  });

  it('rejects Dataset Manifest v2 packages without displayable artifacts', () => {
    const result = parseDtccManifestText(
      'manifest.json',
      JSON.stringify({
        ...smokeSliceManifestV2,
        artifacts: [
          {
            path: 'artifacts/smoke_slice.vtu',
            role: 'primary',
            format: 'vtu',
            media_type: 'application/vnd.vtk.vtu+xml',
            data_kind: 'mesh',
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no displayable/);
  });

  it('rejects malformed visualization metadata', () => {
    const result = parseDtccManifestText(
      'smoke_streamlines.manifest.json',
      JSON.stringify({ ...smokeStreamlinesManifest, visualization: { profile: 'table', width: '1920' } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/visualization.width must be a finite number/);
  });
});
