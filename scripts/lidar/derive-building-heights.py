"""Measure building heights from USGS 3DEP lidar and write them to src/geojson/buildings.geojson.

For each campus building:
    height_m = median elevation of lidar *building* points inside the footprint
             - median elevation of lidar *ground* points 3-15 m outside it
Buildings with too few points get null. Heights are relative to the surrounding ground, so a building on a
slope gets its height above the average ground around it.

Source: USGS 3DEP lidar survey MA_CentralEastern_1_2021 (public domain), read from the Entwine Point Tile
copy on AWS (s3://usgs-lidar-public). Only tiles touching campus buildings are downloaded (about 90 MB at
the default detail level), and they're cached so re-runs are quick.

Requires Python 3 with numpy and laspy[lazrs] (only for this script; the site doesn't need them):
    python3 -m venv .venv && .venv/bin/pip install numpy "laspy[lazrs]"
    .venv/bin/python scripts/lidar/derive-building-heights.py [--cache .cache/lidar] [--dry-run]
"""
import argparse
import json
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import laspy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BUILDINGS = ROOT / 'src/geojson/buildings.geojson'
EPT = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/MA_CentralEastern_1_2021/'
MAX_DEPTH = 10  # EPT detail level: about 4 points per m2 around campus
GROUND, BUILDING = 2, 6  # ASPRS lidar classification codes
GROUND_RING_M = (3, 15)
MIN_POINTS = 10

R = 6378137.0
SCALE = math.cos(math.radians(42.335))  # ground metres per Web Mercator unit at campus latitude


def mercator(lon, lat):
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def footprints(features):
    """Each building's rings in Web Mercator, and its bounding box padded by the ground ring."""
    out = []
    pad = GROUND_RING_M[1] / SCALE
    for f in features:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = [np.array([mercator(*p[:2]) for p in ring]) for poly in polys for ring in poly]
        allpts = np.vstack(rings)
        x0, y0 = allpts.min(axis=0) - pad
        x1, y1 = allpts.max(axis=0) + pad
        out.append({'rings': rings, 'box': (x0, y0, x1, y1)})
    return out


def fetch_points(boxes, cache):
    """Download (or reuse cached) EPT tiles touching any box; return x, y, z, classification arrays."""
    ept = json.load(urllib.request.urlopen(EPT + 'ept.json'))
    b = ept['bounds']

    def node_box(key):
        d, x, y, _ = map(int, key.split('-'))
        size = (b[3] - b[0]) / 2 ** d
        return b[0] + x * size, b[1] + y * size, b[0] + (x + 1) * size, b[1] + (y + 1) * size

    def touches(key):
        nx0, ny0, nx1, ny1 = node_box(key)
        return any(nx0 < x1 and nx1 > x0 and ny0 < y1 and ny1 > y0 for x0, y0, x1, y1 in boxes)

    def hierarchy(key):
        return json.load(urllib.request.urlopen(f'{EPT}ept-hierarchy/{key}.json'))

    tiles, pending = [], ['0-0-0-0']
    with ThreadPoolExecutor(16) as pool:
        while pending:
            parts, pending = list(pool.map(hierarchy, pending)), []
            for part in parts:
                for key, count in part.items():
                    if int(key.split('-')[0]) > MAX_DEPTH or not touches(key):
                        continue
                    if count == -1:
                        pending.append(key)
                    elif count > 0:
                        tiles.append(key)

    os.makedirs(cache, exist_ok=True)

    def download(key):
        path = os.path.join(cache, f'{key}.laz')
        if not os.path.exists(path):
            with urllib.request.urlopen(f'{EPT}ept-data/{key}.laz') as r:
                Path(path).write_bytes(r.read())
        return path

    with ThreadPoolExecutor(12) as pool:
        paths = list(pool.map(download, tiles))
    arrays = {'x': [], 'y': [], 'z': [], 'c': []}
    for path in paths:
        las = laspy.read(path)
        keep = np.isin(las.classification, [GROUND, BUILDING])
        arrays['x'].append(np.asarray(las.x)[keep])
        arrays['y'].append(np.asarray(las.y)[keep])
        arrays['z'].append(np.asarray(las.z)[keep])
        arrays['c'].append(np.asarray(las.classification)[keep])
    print(f'{len(paths)} lidar tiles, {sum(map(len, arrays["x"])):,} ground and building points')
    return tuple(np.concatenate(arrays[k]) for k in 'xyzc')


def inside(px, py, rings):
    """Even-odd point-in-polygon for arrays of points."""
    result = np.zeros(len(px), dtype=bool)
    for ring in rings:
        x1, y1 = ring[:-1, 0], ring[:-1, 1]
        x2, y2 = ring[1:, 0], ring[1:, 1]
        crosses = (y1[None, :] > py[:, None]) != (y2[None, :] > py[:, None])
        with np.errstate(divide='ignore', invalid='ignore'):
            xcross = (x2 - x1)[None, :] * (py[:, None] - y1[None, :]) / (y2 - y1)[None, :] + x1[None, :]
        result ^= (np.count_nonzero(crosses & (px[:, None] < xcross), axis=1) % 2).astype(bool)
    return result


def outline_distance(px, py, rings):
    """Distance in ground metres from each point to the nearest footprint edge."""
    best = np.full(len(px), np.inf)
    for ring in rings:
        a, b = ring[:-1], ring[1:]
        d = b - a
        len2 = np.maximum((d ** 2).sum(axis=1), 1e-9)
        t = np.clip(((px[:, None] - a[None, :, 0]) * d[None, :, 0] + (py[:, None] - a[None, :, 1]) * d[None, :, 1]) / len2[None, :], 0, 1)
        qx = a[None, :, 0] + t * d[None, :, 0]
        qy = a[None, :, 1] + t * d[None, :, 1]
        best = np.minimum(best, np.sqrt((px[:, None] - qx) ** 2 + (py[:, None] - qy) ** 2).min(axis=1))
    return best * SCALE


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', default=str(ROOT / '.cache/lidar'))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    collection = json.loads(BUILDINGS.read_text())
    shapes = footprints(collection['features'])
    x, y, z, c = fetch_points([s['box'] for s in shapes], args.cache)
    is_building = c == BUILDING

    # Points that fall inside any footprint, so a neighbour's roof or walls don't count as ground.
    any_inside = np.zeros(len(x), dtype=bool)
    for s in shapes:
        x0, y0, x1, y1 = s['box']
        near = np.flatnonzero((x >= x0) & (x <= x1) & (y >= y0) & (y <= y1))
        any_inside[near[inside(x[near], y[near], s['rings'])]] = True

    estimated = 0
    for feature, s in zip(collection['features'], shapes):
        x0, y0, x1, y1 = s['box']
        near = np.flatnonzero((x >= x0) & (x <= x1) & (y >= y0) & (y <= y1))
        nx, ny = x[near], y[near]
        in_footprint = inside(nx, ny, s['rings'])
        roof = z[near][in_footprint & is_building[near]]
        ground_candidates = ~in_footprint & ~any_inside[near] & ~is_building[near]
        dist = outline_distance(nx[ground_candidates], ny[ground_candidates], s['rings'])
        ring = (dist >= GROUND_RING_M[0]) & (dist <= GROUND_RING_M[1])
        ground = z[near][ground_candidates][ring]
        height = None
        if len(roof) >= MIN_POINTS and len(ground) >= MIN_POINTS:
            height = round(max(0.0, float(np.median(roof) - np.median(ground))), 1)
            estimated += 1
        feature['properties']['height_m'] = height

    print(f'Heights measured for {estimated} of {len(shapes)} buildings')
    if args.dry_run:
        for f in collection['features']:
            if f['properties']['NAME'] in ("O'Neill Library", 'Gasson Hall', 'Conte Forum', 'Stokes Hall', 'Merkert Chemistry Center',
                                           'McElroy Commons', 'Walsh Hall', 'Gabelli Hall', 'Stayer Hall', 'Law Library', 'Maloney Hall'):
                print(f"  {f['properties']['NAME']}: {f['properties']['height_m']} m")
        return
    # Same layout as the other data files: one feature per line.
    BUILDINGS.write_text('{"type":"FeatureCollection","features":[\n'
                         + ',\n'.join(json.dumps(f, separators=(',', ':'), ensure_ascii=False) for f in collection['features'])
                         + '\n]}\n')
    print(f'Wrote {BUILDINGS.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
