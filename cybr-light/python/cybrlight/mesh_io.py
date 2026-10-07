"""Checked OBJ and ASCII/little/big-endian PLY import. No external mesh library."""
from __future__ import annotations
from pathlib import Path
import struct
import numpy as np


def read_obj(path):
    positions, normals, texcoords, polygons = [], [], [], []
    def index(value, count):
        i = int(value); i = i - 1 if i > 0 else count + i
        if i < 0 or i >= count: raise ValueError("OBJ index is out of range")
        return i
    for line_no, line in enumerate(Path(path).read_text().splitlines(), 1):
        words = line.split('#', 1)[0].split()
        if not words: continue
        try:
            if words[0] == 'v': positions.append([float(v) for v in words[1:4]])
            elif words[0] == 'vn': normals.append([float(v) for v in words[1:4]])
            elif words[0] == 'vt': texcoords.append([float(v) for v in words[1:3]])
            elif words[0] == 'f':
                face = []
                for word in words[1:]:
                    fields = word.split('/')
                    face.append((index(fields[0], len(positions)),
                                 index(fields[1], len(texcoords)) if len(fields) > 1 and fields[1] else None,
                                 index(fields[2], len(normals)) if len(fields) > 2 and fields[2] else None))
                if len(face) < 3: raise ValueError("Face has fewer than three vertices")
                polygons.extend((face[0], face[i], face[i+1]) for i in range(1, len(face)-1))
        except (ValueError, IndexError) as exc:
            raise ValueError(f"{path}:{line_no}: {exc}") from exc
    if not polygons: raise ValueError("OBJ contains no faces")
    use_uv = all(v[1] is not None for f in polygons for v in f)
    use_n = all(v[2] is not None for f in polygons for v in f)
    vertices, uv, ns, faces, mapping = [], [], [], [], {}
    for face in polygons:
        indices = []
        for item in face:
            if item not in mapping:
                mapping[item] = len(vertices); vertices.append(positions[item[0]])
                if use_uv: uv.append(texcoords[item[1]])
                if use_n: ns.append(normals[item[2]])
            indices.append(mapping[item])
        faces.append(indices)
    return np.asarray(vertices), np.asarray(faces), np.asarray(ns) if use_n else None, np.asarray(uv) if use_uv else None

_TYPES = {'char':'b', 'int8':'b', 'uchar':'B', 'uint8':'B', 'short':'h', 'int16':'h',
          'ushort':'H', 'uint16':'H', 'int':'i', 'int32':'i', 'uint':'I', 'uint32':'I',
          'float':'f', 'float32':'f', 'double':'d', 'float64':'d'}

def read_ply(path):
    with Path(path).open('rb') as f:
        if f.readline().strip() != b'ply': raise ValueError("Not a PLY file")
        fmt = None; elements = []; total = 0
        while True:
            raw = f.readline()
            if not raw: raise ValueError("Truncated PLY header")
            total += len(raw)
            if total > 1024**2: raise ValueError("Excessive PLY header")
            words = raw.decode('ascii').split()
            if not words: continue
            if words[0] == 'end_header': break
            if words[0] in ('comment', 'obj_info'): continue
            if words[0] == 'format':
                if words[2] != '1.0': raise ValueError("Unsupported PLY version")
                fmt = words[1]
            elif words[0] == 'element':
                n = int(words[2])
                if n < 0 or n > 20_000_000: raise ValueError("Excessive PLY element count")
                elements.append((words[1], n, []))
            elif words[0] == 'property':
                if not elements: raise ValueError("Property before element")
                if words[1] == 'list': prop = (words[4], words[2], words[3])
                else: prop = (words[2], None, words[1])
                if prop[2] not in _TYPES or prop[1] is not None and prop[1] not in _TYPES: raise ValueError("Unknown PLY scalar type")
                elements[-1][2].append(prop)
            else: raise ValueError("Unsupported PLY header directive")
        if fmt not in ('ascii', 'binary_little_endian', 'binary_big_endian'): raise ValueError("Unsupported PLY format")
        vertices, faces = [], []
        def scalar(t):
            pack = struct.Struct(('<' if fmt == 'binary_little_endian' else '>') + _TYPES[t])
            data = f.read(pack.size)
            if len(data) != pack.size: raise ValueError("Truncated PLY data")
            return pack.unpack(data)[0]
        for name, count, props in elements:
            for _ in range(count):
                row = {}; words = iter(f.readline().decode('ascii').split()) if fmt == 'ascii' else None
                def value(t):
                    if words is None: return scalar(t)
                    try: word = next(words)
                    except StopIteration as exc: raise ValueError("Truncated PLY row") from exc
                    return float(word) if _TYPES[t] in ('f','d') else int(word)
                for key, size_type, item_type in props:
                    if size_type is None: row[key] = value(item_type)
                    else:
                        n = int(value(size_type))
                        if n < 0 or n > 1_000_000: raise ValueError("Invalid PLY list size")
                        row[key] = [value(item_type) for _ in range(n)]
                if name == 'vertex': vertices.append(row)
                elif name == 'face':
                    indices = row.get('vertex_indices', row.get('vertex_index'))
                    if indices is None: raise ValueError("Missing PLY face indices")
                    faces.extend((indices[0], indices[i], indices[i+1]) for i in range(1, len(indices)-1))
    if not vertices or not faces: raise ValueError("PLY contains no triangle geometry")
    p = np.asarray([[v[k] for k in ('x','y','z')] for v in vertices], dtype=float)
    n = np.asarray([[v[k] for k in ('nx','ny','nz')] for v in vertices]) if all(all(k in v for k in ('nx','ny','nz')) for v in vertices) else None
    uvnames = next((keys for keys in [('u','v'),('s','t'),('texture_u','texture_v')] if all(all(k in v for k in keys) for v in vertices)), None)
    uv = np.asarray([[v[k] for k in uvnames] for v in vertices]) if uvnames else None
    indices = np.asarray(faces, dtype=np.int64)
    if not np.isfinite(p).all() or (indices < 0).any() or (indices >= len(p)).any(): raise ValueError("Invalid PLY coordinates or indices")
    return p, indices, n, uv
