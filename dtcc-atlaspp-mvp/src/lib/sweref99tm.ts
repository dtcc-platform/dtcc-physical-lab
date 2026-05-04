// SWEREF99 TM (EPSG:3006) ↔ WGS84 (EPSG:4326) reprojection.
//
// Krueger n-series Transverse Mercator with 4 retained terms on the GRS80
// ellipsoid. Lantmäteriet's published forms are the reference. Sub-meter
// accuracy across Sweden's bounds — many orders of magnitude better than the
// MapLibre `fitBounds` use site needs. No external dependencies.
//
// Used only by `CalibrateOsm.svelte` (the rest of the app stays in 3006).

import type { FeatureCollection } from './geojson';

const A_GRS80 = 6378137;
const F_GRS80 = 1 / 298.257222101;
const LAMBDA0_DEG = 15;
const K0 = 0.9996;
const FE = 500_000;
const FN = 0;

const N3 = F_GRS80 / (2 - F_GRS80);
const N3_2 = N3 * N3;
const N3_3 = N3_2 * N3;
const N3_4 = N3_3 * N3;

const A_HAT = (A_GRS80 / (1 + N3)) * (1 + N3_2 / 4 + N3_4 / 64);

const ALPHA1 = (1 / 2) * N3 - (2 / 3) * N3_2 + (5 / 16) * N3_3 + (41 / 180) * N3_4;
const ALPHA2 = (13 / 48) * N3_2 - (3 / 5) * N3_3 + (557 / 1440) * N3_4;
const ALPHA3 = (61 / 240) * N3_3 - (103 / 140) * N3_4;
const ALPHA4 = (49561 / 161280) * N3_4;

const BETA1 = (1 / 2) * N3 - (2 / 3) * N3_2 + (37 / 96) * N3_3 - (1 / 360) * N3_4;
const BETA2 = (1 / 48) * N3_2 + (1 / 15) * N3_3 - (437 / 1440) * N3_4;
const BETA3 = (17 / 480) * N3_3 - (37 / 840) * N3_4;
const BETA4 = (4397 / 161280) * N3_4;

const DELTA1 = 2 * N3 - (2 / 3) * N3_2 - 2 * N3_3 + (116 / 45) * N3_4;
const DELTA2 = (7 / 3) * N3_2 - (8 / 5) * N3_3 - (227 / 45) * N3_4;
const DELTA3 = (56 / 15) * N3_3 - (136 / 35) * N3_4;
const DELTA4 = (4279 / 630) * N3_4;

const E_FIRST = Math.sqrt(F_GRS80 * (2 - F_GRS80));
const LAMBDA0 = (LAMBDA0_DEG * Math.PI) / 180;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function wgs84ToSweref(lon: number, lat: number): [easting: number, northing: number] {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const dLambda = lambda - LAMBDA0;

  const phiStar = Math.atan(
    Math.sinh(Math.asinh(Math.tan(phi)) - E_FIRST * Math.atanh(E_FIRST * Math.sin(phi))),
  );

  const xiPrime = Math.atan(Math.tan(phiStar) / Math.cos(dLambda));
  const etaPrime = Math.atanh(Math.cos(phiStar) * Math.sin(dLambda));

  const xi =
    xiPrime +
    ALPHA1 * Math.sin(2 * xiPrime) * Math.cosh(2 * etaPrime) +
    ALPHA2 * Math.sin(4 * xiPrime) * Math.cosh(4 * etaPrime) +
    ALPHA3 * Math.sin(6 * xiPrime) * Math.cosh(6 * etaPrime) +
    ALPHA4 * Math.sin(8 * xiPrime) * Math.cosh(8 * etaPrime);
  const eta =
    etaPrime +
    ALPHA1 * Math.cos(2 * xiPrime) * Math.sinh(2 * etaPrime) +
    ALPHA2 * Math.cos(4 * xiPrime) * Math.sinh(4 * etaPrime) +
    ALPHA3 * Math.cos(6 * xiPrime) * Math.sinh(6 * etaPrime) +
    ALPHA4 * Math.cos(8 * xiPrime) * Math.sinh(8 * etaPrime);

  const easting = K0 * A_HAT * eta + FE;
  const northing = K0 * A_HAT * xi + FN;
  return [easting, northing];
}

export function swerefToWgs84(easting: number, northing: number): [lon: number, lat: number] {
  const xi = (northing - FN) / (K0 * A_HAT);
  const eta = (easting - FE) / (K0 * A_HAT);

  const xiPrime =
    xi -
    BETA1 * Math.sin(2 * xi) * Math.cosh(2 * eta) -
    BETA2 * Math.sin(4 * xi) * Math.cosh(4 * eta) -
    BETA3 * Math.sin(6 * xi) * Math.cosh(6 * eta) -
    BETA4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
  const etaPrime =
    eta -
    BETA1 * Math.cos(2 * xi) * Math.sinh(2 * eta) -
    BETA2 * Math.cos(4 * xi) * Math.sinh(4 * eta) -
    BETA3 * Math.cos(6 * xi) * Math.sinh(6 * eta) -
    BETA4 * Math.cos(8 * xi) * Math.sinh(8 * eta);

  const phiStar = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));

  const phi =
    phiStar +
    DELTA1 * Math.sin(2 * phiStar) +
    DELTA2 * Math.sin(4 * phiStar) +
    DELTA3 * Math.sin(6 * phiStar) +
    DELTA4 * Math.sin(8 * phiStar);

  const lambda = LAMBDA0 + Math.atan(Math.sinh(etaPrime) / Math.cos(xiPrime));
  return [lambda * RAD, phi * RAD];
}

// Recursive coordinate-tree mapper: a leaf is [number, number] (or longer with
// z/m). A node is an array of leaves or other nodes. Returns a deeply-cloned
// tree with leaves mapped through `swerefToWgs84` (preserving any extra
// components beyond the first two).
function mapCoords(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords;
  if (
    coords.length >= 2 &&
    typeof coords[0] === 'number' &&
    typeof coords[1] === 'number'
  ) {
    const [easting, northing, ...rest] = coords as number[];
    const [lon, lat] = swerefToWgs84(easting, northing);
    return [lon, lat, ...rest];
  }
  return coords.map(mapCoords);
}

type GeometryWithCoords = { type: string; coordinates?: unknown };
type GeometryCollectionLike = { type: 'GeometryCollection'; geometries: unknown[] };
type Geometry = GeometryWithCoords | GeometryCollectionLike;

function mapGeometry(g: Geometry | null): Geometry | null {
  if (!g) return null;
  if (g.type === 'GeometryCollection') {
    const gc = g as GeometryCollectionLike;
    return {
      type: 'GeometryCollection',
      geometries: gc.geometries.map((inner) => mapGeometry(inner as Geometry)),
    } as GeometryCollectionLike;
  }
  const gc = g as GeometryWithCoords;
  return { ...gc, coordinates: mapCoords(gc.coordinates) };
}

// Returns a deeply-cloned FeatureCollection with every coordinate pair mapped
// from SWEREF99 TM (EPSG:3006) to WGS84. Handles Point, MultiPoint, LineString,
// MultiLineString, Polygon, MultiPolygon, and GeometryCollection.
export function reprojectFcToWgs84(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry: mapGeometry(f.geometry as Geometry),
    })) as FeatureCollection['features'],
  };
}
