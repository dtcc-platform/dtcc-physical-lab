import { describe, expect, it } from 'vitest';
import {
  findManifestArtifact,
  isDtccManifestFile,
  parseDtccManifestText,
  resolveDtccManifestFiles,
} from '../src/lib/dtccManifest';

function file(name: string, contents: string, type = ''): File {
  return new File([contents], name, { type });
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

  it('identifies dtcc-core manifest files by sidecar suffix', () => {
    expect(isDtccManifestFile(file('smoke_streamlines.manifest.json', '{}'))).toBe(true);
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
});
