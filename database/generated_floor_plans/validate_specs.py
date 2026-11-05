"""Read-only synthetic spec audit. Run from any directory; only report is written.

Dependencies: Pillow, numpy. Optional --mask-map JSON maps building IDs to paths.
Default masks: masks/<building_id>.png or masks/<source_image_stem>.png.
An explicit source_mask (or mask_path/source_mask_path/footprint_mask) wins.
Exit 1 means validation errors; 0 may include warnings/skipped mask checks.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import quote

import numpy as np
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def point(value):
    return isinstance(value, list) and len(value) == 2 and all(finite(v) and 0 <= v <= 1000 for v in value)


def distance_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) if den else 0
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def contains(poly, p):
    inside = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if distance_to_segment(p, a, b) < 1e-7:
            return True
        if (a[1] > p[1]) != (b[1] > p[1]):
            if p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]):
                inside = not inside
    return inside


def simple_polygon(poly):
    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    edges = list(zip(poly, poly[1:] + poly[:1]))
    for i, (a, b) in enumerate(edges):
        if a == b:
            return False
        for j in range(i + 1, len(edges)):
            if j == i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            c, d = edges[j]
            u, v, w, z = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
            if u * v < 0 and w * z < 0:
                return False
            if any(abs(val) < 1e-9 and distance_to_segment(p, q, r) < 1e-9
                   for val, p, q, r in [(u, c, a, b), (v, d, a, b), (w, a, c, d), (z, b, c, d)]):
                return False
    return True


def raster(poly, size):
    canvas = Image.new('1', size)
    ImageDraw.Draw(canvas).polygon([(round(x * (size[0] - 1) / 1000), round(y * (size[1] - 1) / 1000)) for x, y in poly], fill=1)
    return np.asarray(canvas, dtype=bool)


def interior(mask):
    result = np.zeros_like(mask)
    result[1:-1, 1:-1] = (mask[1:-1, 1:-1] & mask[:-2, 1:-1] & mask[2:, 1:-1]
                             & mask[1:-1, :-2] & mask[1:-1, 2:])
    return result


def components(mask):
    """Four-neighbor components using row runs, avoiding a pixel-sized Python queue."""
    parents, weights, previous = [], [], []
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for row in mask:
        transitions = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
        current, cursor = [], 0
        for start, stop in zip(transitions[::2], transitions[1::2]):
            idx = len(parents)
            parents.append(idx)
            weights.append(int(stop - start))
            while cursor < len(previous) and previous[cursor][1] <= start:
                cursor += 1
            k = cursor
            while k < len(previous) and previous[k][0] < stop:
                a, b = root(idx), root(previous[k][2])
                if a != b:
                    parents[b] = a
                    weights[a] += weights[b]
                k += 1
            current.append((start, stop, idx))
        previous = current
    return sorted([weights[i] for i in range(len(parents)) if root(i) == i], reverse=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Audit:
    def __init__(self, args):
        self.args = args
        self.issues, self.buildings = [], []
        self.ids = {kind: set() for kind in ('building', 'floor', 'room', 'corridor')}
        self.mask_map = json.loads(args.mask_map.read_text(encoding='utf-8-sig')) if args.mask_map else {}

    def issue(self, severity, code, location, message):
        self.issues.append(dict(severity=severity, code=code, location=location, message=message))

    def unique(self, kind, value, loc):
        if not isinstance(value, str) or not value:
            self.issue('error', 'invalid_id', loc, f'{kind} ID must be a nonempty string')
            return
        if value in self.ids[kind]:
            self.issue('error', 'duplicate_id', loc, f'Duplicate {kind} ID: {value}')
        self.ids[kind].add(value)

    def resolve(self, raw, spec):
        path = Path(raw)
        return next((p for p in (path, spec.parent / path, BASE / path, BASE.parents[1] / path) if p.is_file()), None)

    def geometry(self, obj, loc, corridor=False):
        poly = obj.get('polygon')
        rect = obj.get('rect')
        if rect is not None and poly is not None:
            self.issue('error', 'ambiguous_geometry', loc, 'Use either rect or polygon')
            return None
        if rect is not None and not corridor:
            if not isinstance(rect, list) or len(rect) != 4 or not point(rect[:2]) or not point(rect[2:]) or rect[0] >= rect[2] or rect[1] >= rect[3]:
                self.issue('error', 'invalid_rect', loc, 'Rect must have positive area and coordinates in 0..1000')
                return None
            poly = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]
        if not isinstance(poly, list) or len(poly) < 3 or not all(point(p) for p in poly):
            self.issue('error', 'invalid_polygon', loc, 'Need at least three [x,y] points in 0..1000')
            return None
        if poly[0] == poly[-1]:
            poly = poly[:-1]
        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2
        if area <= 0 or not simple_polygon(poly):
            self.issue('error', 'invalid_area_or_polygon', loc, 'Geometry must be simple and have nonzero area')
            return None
        return poly

    def load_mask(self, data, spec, bid):
        raw = next((data[k] for k in ('source_mask', 'source_mask_path', 'mask_path', 'footprint_mask') if data.get(k)), self.mask_map.get(bid))
        path = self.resolve(raw, spec) if isinstance(raw, str) else None
        if raw and not path:
            self.issue('error', 'mask_missing', bid, f'Explicit mask cannot be read: {raw}')
        if not raw:
            stem = Path(str(data.get('source_image', ''))).stem
            for directory in (self.args.mask_dir, BASE / 'source_masks'):
                for name in (bid, stem, bid + '_mask'):
                    candidate = directory / (name + '.png')
                    if candidate.is_file():
                        path = candidate
                        break
                if path:
                    break
        if not path:
            self.issue('warning', 'mask_checks_skipped', bid, 'No exact source mask; footprint, label/door containment and uncovered fraction skipped')
            return None, None
        with Image.open(path) as image:
            channel = data.get('source_mask_channel', 'luminance')
            if channel not in ('luminance', 'alpha'):
                raise ValueError('source_mask_channel must be luminance or alpha')
            if channel == 'alpha' and 'A' not in image.getbands():
                raise ValueError('alpha mask requested but image has no alpha channel')
            threshold = data.get('source_mask_threshold', 0)
            if not finite(threshold) or not 0 <= threshold <= 254:
                raise ValueError('source_mask_threshold must be 0..254')
            mask = np.asarray(image.getchannel('A') if channel == 'alpha' else image.convert('L')) > threshold
        if not mask.any():
            self.issue('error', 'empty_mask', bid, 'Source mask contains no footprint pixels')
        source = self.resolve(str(data.get('source_image', '')), spec)
        if source:
            with Image.open(source) as image:
                if image.size != (mask.shape[1], mask.shape[0]):
                    self.issue('error', 'canvas_mismatch', bid, 'Mask dimensions differ from original source image')
        return mask, dict(path=str(path.resolve()), sha256=sha(path), width=mask.shape[1], height=mask.shape[0])

    def floor(self, floor, bid, mask, cores):
        idx = floor.get('floor')
        loc = f'{bid}/floor:{idx}'
        fid = floor.get('floor_id', floor.get('id', f'{bid}:f{idx}'))
        self.unique('floor', fid, loc)
        if floor.get('name') != f'Floor {idx}':
            self.issue('warning', 'floor_name', loc, 'Recommended name is Floor followed by 0..3')
        size = (mask.shape[1], mask.shape[0]) if mask is not None else (1001, 1001)
        covered = np.zeros(size[::-1], dtype=bool)
        occupied = np.zeros(size[::-1], dtype=bool)
        corridor_union = np.zeros(size[::-1], dtype=bool)
        names, doors, count = set(), [], 0
        def pixel(p):
            return round(p[1] * (size[1] - 1) / 1000), round(p[0] * (size[0] - 1) / 1000)
        for key in ('spaces', 'corridors'):
            values = floor.get(key)
            if not isinstance(values, list):
                self.issue('error', 'invalid_collection', loc, f'{key} must be an array')
                continue
            for offset, obj in enumerate(values):
                item_loc = f'{loc}/{key}[{offset}]'
                if not isinstance(obj, dict):
                    self.issue('error', 'invalid_object', item_loc, 'Space/corridor must be an object')
                    continue
                number = obj.get('number')
                if not isinstance(number, str) or not number:
                    self.issue('error', 'invalid_number', item_loc, 'number must be a nonempty string')
                elif number in names:
                    self.issue('error', 'duplicate_number', item_loc, f'Duplicate visible number {number}')
                names.add(str(number))
                corridor = key == 'corridors'
                kind = 'corridor' if corridor else 'room'
                ident = obj.get(kind + '_id', obj.get('id', f'{fid}:{"c" if corridor else "r"}:{quote(str(number), safe="")}'))
                self.unique(kind, ident, item_loc)
                if not corridor and (not isinstance(obj.get('type'), str) or not obj['type']):
                    self.issue('error', 'missing_type', item_loc, 'Space type is required')
                poly = self.geometry(obj, item_loc, corridor)
                if poly is None:
                    continue
                count += 1
                shape = raster(poly, size)
                covered |= shape
                if mask is not None and np.any(shape & ~mask):
                    self.issue('warning', 'geometry_outside_mask', item_loc, f'{int(np.count_nonzero(shape & ~mask))} geometry pixels will be clipped')
                if corridor:
                    corridor_union |= shape
                else:
                    inner = interior(shape)
                    overlap = int(np.count_nonzero(inner & occupied))
                    if overlap:
                        self.issue('error', 'room_overlap', item_loc, f'{overlap} interior pixels overlap earlier room interiors')
                    occupied |= inner
                label = obj.get('label')
                if not point(label):
                    self.issue('error', 'invalid_label', item_loc, 'label must be [x,y] in 0..1000')
                else:
                    if not contains(poly, label):
                        self.issue('error', 'label_outside_geometry', item_loc, 'Label anchor is outside its own geometry')
                    if mask is not None and not mask[pixel(label)]:
                        self.issue('error', 'label_outside_mask', item_loc, 'Label anchor is outside exact source footprint')
                if not corridor:
                    door = obj.get('door')
                    if not isinstance(door, list) or len(door) != 3 or not point(door[:2]) or door[2] not in ('N', 'S', 'E', 'W'):
                        self.issue('error', 'invalid_door', item_loc, 'door must be [x,y,N|S|E|W] in range')
                    else:
                        if min(distance_to_segment(door[:2], a, b) for a, b in zip(poly, poly[1:] + poly[:1])) > 1:
                            self.issue('error', 'door_off_boundary', item_loc, 'Door must be within one normalized unit of its room boundary')
                        if mask is not None and not mask[pixel(door)]:
                            self.issue('error', 'door_outside_mask', item_loc, 'Door point is outside exact source footprint')
                        doors.append((door, item_loc))
                    typ = str(obj.get('type', '')).lower()
                    if typ in ('stairs', 'stair', 'staircase', 'stairwell', 'elevator', 'lift', 'elevators'):
                        token = obj.get('core_id')
                        if not token:
                            # Reference labels 000S1/100S1/200S1/300S1 share a core.
                            token = str(number)
                            if token.startswith(str(idx)):
                                token = token[len(str(idx)):]
                            self.issue('warning', 'inferred_core_id', item_loc, 'Add explicit core_id for unambiguous cross-floor matching')
                        bounds = (min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
                        cores.setdefault(str(token), []).append((idx, bounds, item_loc))
        corridor_clipped = corridor_union & mask if mask is not None else corridor_union
        sizes = components(corridor_clipped)
        if len(sizes) != 1:
            self.issue('error', 'corridor_connectivity', loc, f'Corridor union has {len(sizes)} connected components (expected 1)')
        for door, door_loc in doors:
            y, x = pixel(door)
            # Two source pixels or one normalized unit, whichever is larger.
            rx, ry = max(2, math.ceil(size[0] / 1000)), max(2, math.ceil(size[1] / 1000))
            if not corridor_clipped[max(0, y-ry):y+ry+1, max(0, x-rx):x+rx+1].any():
                self.issue('error', 'door_no_corridor', door_loc, 'Door has no adjacent corridor pixels')
        total = int(mask.sum()) if mask is not None else None
        uncovered = int(np.count_nonzero(mask & ~covered)) if mask is not None else None
        return dict(floor=idx, floor_id=fid, geometry_count=count, corridor_components=len(sizes), corridor_component_pixels=sizes,
                    footprint_pixels=total, uncovered_footprint_pixels=uncovered,
                    uncovered_footprint_fraction=uncovered / total if total else None,
                    mask_checks='performed' if mask is not None else 'skipped', raster_width=size[0], raster_height=size[1])

    def spec(self, spec):
        data = json.loads(spec.read_text(encoding='utf-8-sig'))
        if not isinstance(data, dict):
            raise ValueError('Spec root must be an object')
        bid = data.get('building_id')
        self.unique('building', bid, str(spec))
        if not isinstance(bid, str) or not bid:
            return
        for field in ('building_name', 'source_image'):
            if not isinstance(data.get(field), str) or not data[field]:
                self.issue('error', 'missing_field', bid, f'{field} must be a nonempty string')
        if data.get('is_synthetic') is not True:
            self.issue('warning', 'synthetic_disclosure', bid, 'Set is_synthetic=true and retain demo disclosure in exported metadata/UI')
        if not self.resolve(str(data.get('source_image', '')), spec):
            self.issue('warning', 'source_unavailable', bid, 'Source image cannot be read; original canvas dimensions not verified')
        floors = data.get('floors')
        if not isinstance(floors, list):
            self.issue('error', 'invalid_floors', bid, 'floors must be an array')
            return
        indices = [f.get('floor') if isinstance(f, dict) else None for f in floors]
        if len(indices) != 4 or any(type(i) is not int for i in indices) or set(indices) != {0, 1, 2, 3}:
            self.issue('error', 'floor_set', bid, 'Exactly four integer floors 0,1,2,3 are required')
        mask, info = self.load_mask(data, spec, bid)
        cores, results = {}, []
        for f in floors:
            if not isinstance(f, dict):
                self.issue('error', 'invalid_floor', bid, 'Floor must be an object')
                continue
            results.append(self.floor(f, bid, mask, cores))
        for token, occurrences in cores.items():
            if len(occurrences) != 4 or {entry[0] for entry in occurrences} != {0, 1, 2, 3}:
                self.issue('error', 'core_floor_set', bid, f'Core {token} must appear once on each floor')
            bounds = occurrences[0][1]
            for _, other, loc in occurrences[1:]:
                if max(abs(a-b) for a, b in zip(bounds, other)) > self.args.core_tolerance:
                    self.issue('error', 'core_moved', loc, f'Core {token} bounds moved by more than {self.args.core_tolerance} normalized units')
        self.buildings.append(dict(building_id=bid, spec_path=str(spec.resolve()), spec_sha256=sha(spec), mask=info, floors=results))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec-dir', type=Path, default=BASE / 'specs')
    parser.add_argument('--mask-dir', type=Path, default=BASE / 'masks')
    parser.add_argument('--mask-map', type=Path)
    parser.add_argument('--output', type=Path, default=BASE / 'review' / 'spec_validation.json')
    parser.add_argument('--core-tolerance', type=float, default=1.0)
    args = parser.parse_args()
    audit = Audit(args)
    specs = sorted(args.spec_dir.glob('*.json'))
    for spec in specs:
        try:
            audit.spec(spec)
        except (OSError, ValueError, TypeError, KeyError, IndexError, OverflowError) as exc:
            audit.issue('error', 'spec_unreadable', str(spec), f'{type(exc).__name__}: {exc}')
    if not specs:
        audit.issue('warning', 'no_specs', str(args.spec_dir), 'No specs/*.json found; validator is ready for generated inputs')
    errors = sum(i['severity'] == 'error' for i in audit.issues)
    report = dict(schema_version='1.0', generated_at=datetime.now(timezone.utc).isoformat(),
                  status='no_specs' if not specs else 'failed' if errors else 'passed_with_warnings' if audit.issues else 'passed',
                  spec_count=len(specs), errors=errors, warnings=sum(i['severity'] == 'warning' for i in audit.issues),
                  methodology={'coordinates': 'original canvas; 0..1000 inclusive', 'overlap': 'one-pixel boundary excluded from both rooms',
                               'connectivity': 'four-neighbor corridor union, clipped to source mask when available',
                               'uncovered': 'footprint minus union of room and corridor polygons',
                               'mask_threshold': 'nonzero luminance unless explicitly configured',
                               'core_tolerance': args.core_tolerance,
                               'limitations': 'Anchor checks do not validate rendered font extents; finite raster resolution can miss subpixel gaps/overlaps.'},
                  buildings=audit.buildings, issues=audit.issues)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{report["status"]}: {len(specs)} specs, {errors} errors, {report["warnings"]} warnings; {args.output}')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
