#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isSafeRelativeFile(file) {
  if (file.length === 0) return false;
  if (file.startsWith('/')) return false;
  if (file.includes('://')) return false;
  if (file.startsWith('../')) return false;
  if (file.includes('/../')) return false;
  return true;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatName(manifest) {
  return typeof manifest.format === 'string' && manifest.format.length > 0 ? manifest.format.toLowerCase() : 'unknown';
}

function kindForManifest(manifest) {
  const format = formatName(manifest);
  if (format === 'geojson') return { kind: 'geojson', format, mediaType: manifest.media_type };
  if (format === 'png') {
    if (manifest.data_kind !== 'raster') throw new Error('png manifests must have data_kind raster');
    if (manifest.media_type !== 'image/png') throw new Error('png manifests must have media_type image/png');
    return { kind: 'image', format, mediaType: 'image/png' };
  }
  if (format === 'mp4') {
    if (manifest.data_kind !== 'video') throw new Error('mp4 manifests must have data_kind video');
    if (manifest.media_type !== 'video/mp4') throw new Error('mp4 manifests must have media_type video/mp4');
    return { kind: 'video', format, mediaType: 'video/mp4' };
  }
  return null;
}

function supportedVisualization(value) {
  if (!isRecord(value)) return undefined;
  const out = {};
  for (const key of ['profile', 'width', 'height', 'fps', 'duration']) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function findManifestPaths(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const paths = [];

  for (const item of items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const itemPath = join(dir, item.name);
    if (item.isDirectory()) {
      paths.push(...(await findManifestPaths(itemPath)));
    } else if (item.isFile() && item.name.endsWith('.manifest.json')) {
      paths.push(itemPath);
    }
  }

  return paths;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readCatalog(catalogPath) {
  if (!existsSync(catalogPath)) return { version: 1, entries: [] };

  const catalog = await readJson(catalogPath);
  if (!isRecord(catalog) || catalog.version !== 1 || !Array.isArray(catalog.entries)) {
    throw new Error(`${catalogPath} must be a version 1 catalog with entries`);
  }

  const seen = new Set();
  for (const entry of catalog.entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`${catalogPath} contains a catalog entry without a valid id`);
    }
    if (seen.has(entry.id)) throw new Error(`${catalogPath} contains duplicate catalog id "${entry.id}"`);
    seen.add(entry.id);
  }

  return catalog;
}

function parseManifest(manifestPath, manifest, datasetsDir) {
  if (!isRecord(manifest)) throw new Error(`${manifestPath} must contain a JSON object`);
  if (typeof manifest.file !== 'string' || !isSafeRelativeFile(manifest.file)) {
    throw new Error(`${manifestPath} file must be relative to the manifest directory`);
  }

  const manifestKind = kindForManifest(manifest);
  if (manifestKind === null) {
    return {
      skipped: {
        manifest: manifestPath,
        reason: `format ${formatName(manifest)} is not supported by the Atlas catalog`,
      },
    };
  }

  if (!isBounds(manifest.bounds)) {
    throw new Error(`${manifestPath} bounds must be four finite numbers`);
  }
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    throw new Error(`${manifestPath} description must be a string when present`);
  }

  const fileName = basename(manifest.file);
  const id = typeof manifest.id === 'string' && manifest.id.trim().length > 0 ? manifest.id.trim() : slugify(fileName);
  if (id.length === 0) throw new Error(`${manifestPath} must provide an id or sluggable file name`);

  const sourceFile = resolve(dirname(manifestPath), manifest.file);
  const targetFile = resolve(datasetsDir, fileName);
  if (!existsSync(sourceFile)) throw new Error(`${manifestPath} references missing file ${manifest.file}`);

  const entry = {
    id,
    title:
      typeof manifest.title === 'string' && manifest.title.trim().length > 0
        ? manifest.title.trim()
        : titleFromId(id),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    file: relative(datasetsDir, targetFile),
    bounds: manifest.bounds,
    kind: manifestKind.kind,
    format: manifestKind.format,
    ...(manifestKind.mediaType !== undefined ? { mediaType: manifestKind.mediaType } : {}),
  };
  const visualization = supportedVisualization(manifest.visualization);
  if ((manifestKind.kind === 'image' || manifestKind.kind === 'video') && visualization !== undefined) {
    entry.visualization = visualization;
  }

  return {
    entry,
    sourceFile,
    targetFile,
    manifestPath,
  };
}

function mergeCatalogEntries(existingEntries, importedEntries) {
  const entries = [...existingEntries];
  const indexes = new Map(entries.map((entry, index) => [entry.id, index]));

  for (const entry of importedEntries) {
    const index = indexes.get(entry.id);
    if (index === undefined) {
      indexes.set(entry.id, entries.length);
      entries.push(entry);
    } else {
      entries[index] = entry;
    }
  }

  return entries;
}

export async function ingestManifests({ sourceDir, datasetsDir, catalogPath }) {
  const resolvedSourceDir = resolve(sourceDir);
  const resolvedDatasetsDir = resolve(datasetsDir);
  const resolvedCatalogPath = resolve(catalogPath);
  const manifestPaths = await findManifestPaths(resolvedSourceDir);
  const imported = [];
  const skipped = [];
  const seenImportedIds = new Map();

  for (const manifestPath of manifestPaths) {
    const manifest = await readJson(manifestPath);
    const parsed = parseManifest(manifestPath, manifest, resolvedDatasetsDir);
    if (parsed.skipped) {
      skipped.push(parsed.skipped);
      continue;
    }

    const previousPath = seenImportedIds.get(parsed.entry.id);
    if (previousPath !== undefined) {
      throw new Error(`duplicate imported catalog id "${parsed.entry.id}" in ${previousPath} and ${manifestPath}`);
    }
    seenImportedIds.set(parsed.entry.id, manifestPath);
    imported.push(parsed);
  }

  await mkdir(resolvedDatasetsDir, { recursive: true });
  for (const item of imported) {
    if (item.sourceFile !== item.targetFile) {
      await copyFile(item.sourceFile, item.targetFile);
    }
  }

  const existingCatalog = await readCatalog(resolvedCatalogPath);
  const entries = mergeCatalogEntries(
    existingCatalog.entries,
    imported.map((item) => item.entry)
  );
  const catalog = { version: 1, entries };
  await writeFile(resolvedCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  return {
    imported: imported.map((item) => item.entry),
    skipped,
    catalog,
  };
}

function usage() {
  return [
    'Usage: npm run catalog:ingest -- <manifest-dir> [--datasets-dir public/datasets] [--catalog public/datasets/catalog.json]',
    '',
    'Scans recursively for dtcc-core *.manifest.json files, copies GeoJSON/PNG/MP4 artifacts into public/datasets,',
    'and upserts compatible entries into catalog.json. Unsupported formats are skipped with a warning.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = [...argv];
  let sourceDir;
  let datasetsDir = resolve(process.cwd(), 'public', 'datasets');
  let catalogPath = join(datasetsDir, 'catalog.json');

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--datasets-dir') {
      const value = args.shift();
      if (!value) throw new Error('--datasets-dir requires a value');
      datasetsDir = resolve(value);
      if (catalogPath.endsWith(join('public', 'datasets', 'catalog.json'))) {
        catalogPath = join(datasetsDir, 'catalog.json');
      }
      continue;
    }
    if (arg === '--catalog') {
      const value = args.shift();
      if (!value) throw new Error('--catalog requires a value');
      catalogPath = resolve(value);
      continue;
    }
    if (arg?.startsWith('--')) throw new Error(`unknown option ${arg}`);
    if (sourceDir !== undefined) throw new Error(`unexpected argument ${arg}`);
    sourceDir = arg;
  }

  if (!sourceDir) throw new Error(usage());
  return { sourceDir, datasetsDir, catalogPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await ingestManifests(options);

  for (const skipped of result.skipped) {
    console.warn(`Skipped ${skipped.manifest}: ${skipped.reason}`);
  }
  console.log(`Imported ${result.imported.length} GeoJSON manifest(s) into ${resolve(options.catalogPath)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
