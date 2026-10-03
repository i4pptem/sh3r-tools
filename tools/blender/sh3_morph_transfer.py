"""Transfer SH3 shape-key displacements to an aligned replacement surface."""
bl_info = {
    'name': 'Silent Hill 3 Morph Transfer', 'author': 'i4pptem', 'version': (1, 3, 2),
    'blender': (4, 2, 0), 'location': 'View3D > Sidebar > SH3 Tools',
    'description': 'Create matching pose morphs on replacement meshes', 'category': 'Object',
}

import json
import math
import heapq
import hashlib
from collections import defaultdict
import numpy as np
import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy.props import PointerProperty, StringProperty, FloatProperty, IntProperty, CollectionProperty, EnumProperty, BoolProperty



class LandmarkWarp:
    """Similarity alignment plus a smooth residual field through paired neutral landmarks."""

    def __init__(self, source, target):
        a, b = np.asarray(source, dtype=float), np.asarray(target, dtype=float)
        if a.shape != b.shape or a.ndim != 2 or a.shape[1] != 3 or not 3 <= len(a) <= 64:
            raise ValueError('Use 3–64 paired landmarks in neutral surfaces.')
        if not np.isfinite(a).all() or not np.isfinite(b).all():
            raise ValueError('Landmarks contain non-finite positions.')
        self.center = a.mean(axis=0)
        ac, bc = a - self.center, b - b.mean(axis=0)
        if min(np.linalg.matrix_rank(ac), np.linalg.matrix_rank(bc)) < 2:
            raise ValueError('Landmarks must not lie on a single line. Spread them across the region.')
        u, singular, vt = np.linalg.svd(ac.T @ bc)
        correction = np.eye(3)
        correction[-1, -1] = np.linalg.det(u @ vt)
        self.rotation = u @ correction @ vt
        self.scale = np.sum(singular * np.diag(correction)) / np.sum(ac * ac)
        if self.scale <= 0:
            raise ValueError('Landmark alignment has no positive scale.')
        self.destination = b.mean(axis=0)
        self.anchors = a
        distances = np.linalg.norm(a[:, None, :] - a[None, :, :], axis=2)
        nearest = distances.copy()
        np.fill_diagonal(nearest, np.inf)
        self.radius = float(np.median(nearest.min(axis=1))) * 3
        if self.radius <= 0:
            raise ValueError('Landmarks share the same neutral position. Remove duplicate points.')
        kernel = self.kernel(distances)
        if np.linalg.cond(kernel) > 1e10:
            raise ValueError('Landmarks are duplicated or too close together. Spread or remove them.')
        residual = b - self.similarity(a)
        self.coefficients = np.linalg.solve(kernel, residual)

    def kernel(self, distances):
        """Compact residual support prevents a close lip pair from warping the whole head."""
        t = np.minimum(distances / self.radius, 1)
        return (1 - t) ** 4 * (4 * t + 1)

    def similarity(self, values):
        return (values - self.center) @ self.rotation * self.scale + self.destination

    def array(self, points):
        values = np.asarray(points, dtype=float)
        result = self.similarity(values)
        for start in range(0, len(values), 8192):
            block = values[start:start + 8192]
            distances = np.linalg.norm(block[:, None, :] - self.anchors[None, :, :], axis=2)
            result[start:start + len(block)] += self.kernel(distances) @ self.coefficients
        return result

    def vectors(self, points):
        return [Vector(point) for point in self.array(points)]

    def displacements(self, values):
        """Transport motion without feeding posed points back into the neutral warp."""
        return [Vector(point) for point in np.asarray(values) @ self.rotation * self.scale]


def paired_landmarks(settings):
    if settings.match_mode == 'SURFACE':
        return None
    a, b = [], []
    used = [set(), set()]
    for pair in settings.landmarks:
        for side, obj, index, output, seen in (('source', settings.source, pair.source_vertex, a, used[0]),
                                   ('target', settings.target, pair.target_vertex, b, used[1])):
            if obj is None or not 0 <= index < len(obj.data.vertices):
                raise ValueError(f'{pair.name}: capture a valid source and target vertex.')
            if index in seen:
                raise ValueError(f'{pair.name}: {side} vertex {index} is already assigned to another landmark.')
            seen.add(index)
            captured = getattr(pair, side + '_topology')
            if captured and captured != topology_signature(obj):
                raise ValueError(f'{pair.name}: {side} topology changed. Recapture this landmark.')
            basis = obj.data.shape_keys.reference_key.data if obj.data.shape_keys else obj.data.vertices
            output.append(obj.matrix_world @ basis[index].co)
    return a, b


class SH3MorphLandmark(bpy.types.PropertyGroup):
    name: StringProperty(name='Landmark', default='Anchor')
    source_vertex: IntProperty(name='Source vertex', default=-1, min=-1)
    target_vertex: IntProperty(name='Target vertex', default=-1, min=-1)
    source_topology: StringProperty(options={'HIDDEN'})
    target_topology: StringProperty(options={'HIDDEN'})


class SH3_UL_landmarks(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        layout.prop(item, 'name', text='', emboss=False)
        layout.label(text=f'{item.source_vertex} → {item.target_vertex}')


class SH3_OT_landmark(bpy.types.Operator):
    bl_idname = 'sh3.landmark'
    bl_label = 'Edit morph landmark'
    bl_options = {'REGISTER', 'UNDO'}
    action: EnumProperty(items=[(x, x, '') for x in ('ADD', 'REMOVE', 'FACE', 'TEMPLATE', 'SOURCE', 'TARGET')])

    def execute(self, context):
        settings = context.scene.sh3_morph_transfer
        if self.action == 'ADD':
            settings.landmarks.add().name = 'Anchor ' + str(len(settings.landmarks))
            settings.landmark_index = len(settings.landmarks) - 1
        elif self.action == 'REMOVE':
            if settings.landmarks:
                settings.landmarks.remove(settings.landmark_index)
                settings.landmark_index = max(0, min(settings.landmark_index, len(settings.landmarks) - 1))
        elif self.action in {'FACE', 'TEMPLATE'}:
            preset = 'FACE' if self.action == 'FACE' else settings.template
            for name in LANDMARK_TEMPLATES[preset]:
                if name not in settings.landmarks:
                    settings.landmarks.add().name = name
        else:
            obj = settings.source if self.action == 'SOURCE' else settings.target
            if not settings.landmarks or context.active_object != obj or context.mode != 'EDIT_MESH':
                self.report({'ERROR'}, 'Select the matching mesh, enter Edit Mode and select one vertex.')
                return {'CANCELLED'}
            bm = bmesh.from_edit_mesh(obj.data)
            bm.verts.index_update()
            bm.verts.ensure_lookup_table()
            selected = [v.index for v in bm.verts if v.select]
            if len(selected) != 1:
                self.report({'ERROR'}, 'Select exactly one neutral-surface vertex.')
                return {'CANCELLED'}
            capture_landmark(settings, self.action.lower(), selected[0])
        return {'FINISHED'}


def mesh_object(_self, obj):
    return obj.type == 'MESH'


def weights(obj, name):
    if not name:
        return [1.0] * len(obj.data.vertices)
    group = obj.vertex_groups.get(name)
    if group is None:
        raise ValueError('Missing vertex group: ' + name)
    return [next((g.weight for g in vertex.groups if g.group == group.index), 0.0)
            for vertex in obj.data.vertices]


def barycentric(point, a, b, c):
    ab, ac, ap = b - a, c - a, point - a
    aa, bb, cc = ab.dot(ab), ab.dot(ac), ac.dot(ac)
    denominator = aa * cc - bb * bb
    if denominator <= 0:
        raise ValueError('Source contains a degenerate surface triangle.')
    v = (cc * ap.dot(ab) - bb * ap.dot(ac)) / denominator
    w = (aa * ap.dot(ac) - bb * ap.dot(ab)) / denominator
    return (1 - v - w, v, w)


def adjacency(mesh):
    neighbors = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    return neighbors


def basis_points(obj):
    data = obj.data.shape_keys.reference_key.data if obj.data.shape_keys else obj.data.vertices
    return [obj.matrix_world @ p.co for p in data]


def topology_signature(obj):
    edges = np.empty(len(obj.data.edges) * 2, dtype=np.int32)
    obj.data.edges.foreach_get('vertices', edges)
    return f'{len(obj.data.vertices)}:' + hashlib.sha256(edges.tobytes()).hexdigest()


def surface_graph(obj, labels=None):
    """World-distance graph; coincident seam vertices share the same surface location."""
    points = basis_points(obj)
    graph = [dict() for _ in points]
    coincident = defaultdict(list)
    for i, point in enumerate(points):
        coincident[(tuple(point), labels[i] if labels else 0)].append(i)
    for edge in obj.data.edges:
        a, b = edge.vertices
        if labels is None or labels[a] == labels[b]:
            graph[a][b] = graph[b][a] = (points[a] - points[b]).length
    for ids in coincident.values():
        for i in ids[1:]:
            graph[i][ids[0]] = graph[ids[0]][i] = 0
    return graph


def geodesic_distances(graph, seed, radius=float('inf'), allowed=None):
    distances = np.full(len(graph), np.inf)
    distances[seed] = 0
    pending = [(0, seed)]
    while pending:
        cost, i = heapq.heappop(pending)
        if cost != distances[i]:
            continue
        for j, length in graph[i].items():
            if allowed is not None and not allowed[j]:
                continue
            value = cost + length
            if value < distances[j] and value < radius:
                distances[j] = value
                heapq.heappush(pending, (value, j))
    return distances


class AnchorMotion:
    """Interpolate landmark motion residuals locally along the target surface.

    Compact geodesic kernels keep opposite lips and detached layers independent.
    The small interpolation solve pins anchors exactly, including after smoothing.
    """

    def __init__(self, target, pairs, radius, labels, mask, allowed_regions=None):
        points = np.array(basis_points(target))
        self.radius = radius or float(np.linalg.norm(np.ptp(points, axis=0))) * .1
        if self.radius <= 0:
            raise ValueError('Landmark influence needs a nonzero target surface size.')
        self.indices = [dst for _, dst in pairs]
        if len(set(self.indices)) != len(self.indices):
            raise ValueError('Each target landmark must use a different vertex.')
        if len(points) * len(self.indices) > 20000000:
            raise ValueError('Landmark correction exceeds 20 million vertex/anchor pairs. Use a smaller target part or fewer landmarks.')
        if any(not 0 <= i < len(points) for i in self.indices):
            raise ValueError('Landmark vertex is outside the target topology.')
        if any(mask[i] <= 0 for i in self.indices):
            raise ValueError('Motion landmarks must lie inside the active target mask.')
        graph = surface_graph(target)
        allowed_regions = allowed_regions or [{0, labels[i]} for i in self.indices]
        distances = np.array([geodesic_distances(graph, i, self.radius,
                    [label in allowed for label in labels])
                    for i, allowed in zip(self.indices, allowed_regions)]).T
        t = np.minimum(distances / self.radius, 1)
        self.kernel = (1 - t) ** 4 * (4 * t + 1) * np.asarray(mask)[:, None]
        matrix = self.kernel[self.indices]
        if np.linalg.cond(matrix) > 1e10:
            raise ValueError('Motion landmarks share a seam position. Keep one landmark per location.')
        self.inverse = np.linalg.inv(matrix)
        self.active = np.asarray(mask) > 0

    def apply(self, key, desired, unmatched=()):
        residual = np.array([desired[i] - key.data[i].co for i in self.indices])
        correction = self.kernel @ self.inverse @ residual
        active = self.active.copy()
        active[list(unmatched)] = False
        for i in np.flatnonzero(active):
            key.data[i].co += Vector(correction[i])


def stored_region_labels(obj):
    metadata = json.loads(obj.get('sh3_morph_transfer', '{}'))
    labels = [0] * len(obj.data.vertices)
    for n, region in enumerate(metadata.get('protected_regions', []), 1):
        for i, value in enumerate(weights(obj, region['target'])):
            if value > 0:
                if labels[i]:
                    raise ValueError('Protected regions overlap. Fix the region groups before smoothing.')
                labels[i] = n
    return labels


def smooth_field(deltas, neighbors, mask, iterations, factor, regions=None):
    """Diffuse displacement along surface edges, preserving masked regions and Basis."""
    values = [value.copy() for value in deltas]
    for _ in range(iterations):
        output = [value.copy() for value in values]
        for i, links in enumerate(neighbors):
            active = [j for j in links if mask[j] > 0 and
                      (regions is None or regions[j] == regions[i] or 0 in (regions[i], regions[j]))]
            if mask[i] > 0 and active:
                average = sum((values[j] for j in active), Vector()) / len(active)
                output[i] = values[i].lerp(average, factor * mask[i])
        values = output
    return values


def smooth_keys(obj, iterations=3, factor=.35, group='', names=None, regions=None, excluded=()):
    """Smooth relative key deltas in place; caller owns the copy and undo boundary."""
    if iterations == 0 or factor == 0:
        return
    keys = obj.data.shape_keys
    if keys is None or not keys.use_relative:
        raise ValueError('Choose a mesh with relative shape keys.')
    neighbors, mask = adjacency(obj.data), weights(obj, group)
    for index in excluded:
        mask[index] = 0
    # Capture every relative displacement before changing referenced keys.
    fields = [(key, [p.co - q.co for p, q in zip(key.data, key.relative_key.data)])
              for key in keys.key_blocks if key != keys.reference_key and (names is None or key.name in names)]
    pending = {key.name: (key, smooth_field(values, neighbors, mask, iterations, factor, regions)) for key, values in fields}
    while pending:
        ready = [name for name, (key, _) in pending.items() if key.relative_key.name not in pending]
        if not ready:
            raise ValueError('Shape keys contain a circular relative-key reference.')
        for name in ready:
            key, values = pending.pop(name)
            for point, relative, value in zip(key.data, key.relative_key.data, values):
                point.co = relative.co + value


def correspondence_regions(source, target, points, triangles, regions):
    """Build one matching surface per exclusive target region.

    Positive target weights define exclusive membership. Full weights enforce
    regional matching; fractional weights feather toward the whole surface.
    """
    labels = [0] * len(target.data.vertices)
    surfaces = [(triangles, BVHTree.FromPolygons(points, triangles, all_triangles=True))]
    names = ['Whole surface']
    for label, source_group, target_group in regions:
        if not source_group or not target_group:
            raise ValueError(f'{label}: choose both Source group and Target group.')
        source_mask, target_mask = weights(source, source_group), weights(target, target_group)
        region_triangles = [triangle for triangle in triangles if all(source_mask[i] > 0 for i in triangle)]
        if not region_triangles:
            raise ValueError(f'{label}: source group contains no complete usable triangles.')
        members = [i for i, value in enumerate(target_mask) if value > 0]
        if not members:
            raise ValueError(f'{label}: target group has no vertices.')
        region_id = len(surfaces)
        for i in members:
            if labels[i]:
                raise ValueError(f'Target vertex {i} belongs to both {names[labels[i]]} and {label}. Protected target regions must not overlap.')
            labels[i] = region_id
        names.append(label)
        surfaces.append((region_triangles, BVHTree.FromPolygons(points, region_triangles, all_triangles=True)))
    return surfaces, labels


def nearest_surface_match(point, surface, distance):
    triangles, tree = surface
    hit, _normal, face, _distance = tree.find_nearest(point, distance)
    return (triangles[face], hit) if face is not None else None


def sample_displacement(deltas, match):
    triangle, bary = match
    return sum((deltas[v] * weight for v, weight in zip(triangle, bary)), Vector())


def apply_depth_corrections(result, target, corrections, selected_names, target_mask, unmatched):
    """Adjust signed facial depth without changing the perpendicular opening motion."""
    transform = target.matrix_world.to_3x3()
    inverse = transform.inverted()
    excluded = set(unmatched)
    basis = result.data.shape_keys.reference_key
    for name, group, direction, inward, outward in corrections:
        if name not in selected_names:
            continue
        direction = Vector(direction)
        if direction.length_squared == 0 or not all(math.isfinite(v) for v in direction):
            raise ValueError('Facial depth direction is invalid. Recapture mouth corners, chin and nose.')
        if not all(math.isfinite(v) and 0 <= v <= 2 for v in (inward, outward)):
            raise ValueError('Depth strengths must be between 0 and 2.')
        direction.normalize()
        mask = weights(target, group)
        key = result.data.shape_keys.key_blocks[name]
        for i, value in enumerate(mask):
            if value <= 0 or target_mask[i] <= 0 or i in excluded:
                continue
            displacement = transform @ (key.data[i].co - basis.data[i].co)
            depth = displacement.dot(direction)
            strength = inward if depth < 0 else outward
            key.data[i].co += inverse @ (direction * depth * (strength - 1) * value * target_mask[i])


def transfer(source, target, source_group='', target_group='', max_distance=0.0, strength=1.0,
             smooth_iterations=3, smooth_strength=.35, landmarks=None, regions=(), names=None,
             landmark_indices=(), anchor_radius=0, depth_corrections=()):
    """Create a separate target copy with barycentrically transferred relative keys.

    Geometry is read in undeformed Basis space, including object placement.
    Source masks restrict correspondence; target masks blend displacement only.
    Paired regions restrict both matching and displacement smoothing across layers.
    Rig, topology, weights and source key values remain untouched.
    """
    if source is None or target is None or source == target or source.type != 'MESH' or target.type != 'MESH':
        raise ValueError('Choose two different mesh objects: original morph source and replacement target.')
    keys = source.data.shape_keys
    if keys is None or len(keys.key_blocks) < 2 or not keys.use_relative:
        raise ValueError('The source needs relative shape keys exported from SH3 Tools.')
    selected_keys = [key for key in list(keys.key_blocks)[1:] if names is None or key.name in names]
    if not selected_keys or (names is not None and set(names) != {key.name for key in selected_keys}):
        raise ValueError('Choose a morph present on the source mesh.')
    if any(abs(obj.matrix_world.determinant()) < 1e-12 for obj in (source, target)):
        raise ValueError('Source and target need invertible object transforms.')
    if target.data.shape_keys and not target.data.shape_keys.use_relative:
        raise ValueError('Absolute shape keys on the target are not supported.')
    if not all(math.isfinite(value) for obj in (source, target) for row in obj.matrix_world for value in row):
        raise ValueError('Invalid object transform.')
    if len(selected_keys) * len(target.data.vertices) > 20000000:
        raise ValueError('Transfer exceeds 20 million shape-key vertices. Split the target into facial regions.')
    basis = keys.reference_key
    points = [source.matrix_world @ point.co for point in basis.data]
    target_basis = target.data.shape_keys.reference_key.data if target.data.shape_keys else target.data.vertices
    targets = [target.matrix_world @ point.co for point in target_basis]
    warp = LandmarkWarp(*landmarks) if landmarks is not None else None
    if warp:
        points = warp.vectors(points)
    source_weights, target_weights = weights(source, source_group), weights(target, target_group)
    source.data.calc_loop_triangles()
    triangles = [tuple(face.vertices) for face in source.data.loop_triangles
                 if all(source_weights[v] > 0 for v in face.vertices)
                 and (points[face.vertices[1]] - points[face.vertices[0]]).cross(points[face.vertices[2]] - points[face.vertices[0]]).length_squared > 0]
    if not triangles:
        raise ValueError('The source region has no usable triangles. Include whole faces in the source vertex group.')
    if not any(value > 0 for value in target_weights):
        raise ValueError('The target region contains no weighted vertices.')
    surfaces, region_labels = correspondence_regions(source, target, points, triangles, regions)
    region_masks = [weights(source, r[1]) for r in regions]
    anchor_regions = [{0} | {n + 1 for n, mask in enumerate(region_masks) if 0 <= src < len(mask) and mask[src] > 0}
                      for src, _ in landmark_indices]
    anchors = AnchorMotion(target, landmark_indices, anchor_radius, region_labels, target_weights, anchor_regions) if landmark_indices else None
    if max_distance <= 0:
        minimum = Vector(tuple(min(p[i] for p in points) for i in range(3)))
        maximum = Vector(tuple(max(p[i] for p in points) for i in range(3)))
        max_distance = (maximum - minimum).length * .05
    region_mix = [1.0] * len(targets)
    for n, region in enumerate(regions, 1):
        for i, weight in enumerate(weights(target, region[2])):
            if region_labels[i] == n:
                region_mix[i] = weight
    mapping, unmatched, outer_mapping = [], [], {}
    for index, point in enumerate(targets):
        found = nearest_surface_match(point, surfaces[region_labels[index]], max_distance) if target_weights[index] > 0 else None
        if found is None:
            mapping.append(None)
            if target_weights[index] > 0:
                unmatched.append(index)
        else:
            triangle, hit = found
            mapping.append((triangle, barycentric(hit, *(points[v] for v in triangle))))
            if region_labels[index] and region_mix[index] < 1:
                triangle, hit = nearest_surface_match(point, surfaces[0], max_distance)
                outer_mapping[index] = (triangle, barycentric(hit, *(points[v] for v in triangle)))
    for src, dst in landmark_indices:
        if not 0 <= src < len(points) or source_weights[src] <= 0 or target_weights[dst] <= 0:
            raise ValueError('Motion landmarks must lie inside the active source/target masks.')
        region = region_labels[dst]
        if region and weights(source, regions[region - 1][1])[src] <= 0:
            raise ValueError(f'{regions[region - 1][0]}: source landmark {src} for target {dst} lies outside its protected source region.')
        mapping[dst] = ((src, src, src), (1, 0, 0))
        outer_mapping.pop(dst, None)
    unmatched = [i for i in unmatched if mapping[i] is None]
    if all(item is None for item in mapping):
        raise ValueError('No target vertices matched. Align the neutral surfaces or increase Maximum distance.')
    result = target.copy()
    result.data = target.data.copy()
    result.name = target.name + '_Morphs'
    result.show_only_shape_key = False
    bpy.context.collection.objects.link(result)
    try:
        result.animation_data_clear()
        if result.data.shape_keys:
            result.data.shape_keys.animation_data_clear()
        else:
            result.shape_key_add(name='Basis', from_mix=False)
        inverse = target.matrix_world.to_3x3().inverted()
        source_transform = source.matrix_world.to_3x3()
        desired_anchors = {}
        for key in selected_keys:
            output = result.data.shape_keys.key_blocks.get(key.name)
            if output is None:
                output = result.shape_key_add(name=key.name, from_mix=False)
            output.relative_key = result.data.shape_keys.reference_key
            output.value, output.mute, output.vertex_group = 0, False, ''
            output.slider_min, output.slider_max = key.slider_min, key.slider_max
            influence = weights(source, key.vertex_group)
            deltas = [source_transform @ (point.co - relative.co) * influence[i] for i, (point, relative) in enumerate(zip(key.data, key.relative_key.data))]
            if warp:
                deltas = warp.displacements(deltas)
            if anchors:
                desired_anchors[key.name] = {dst: output.data[dst].co * (1 - target_weights[dst]) +
                    (target_basis[dst].co + inverse @ deltas[src] * strength) * target_weights[dst]
                    for src, dst in landmark_indices}
            for index, match in enumerate(mapping):
                displacement = Vector()
                if match:
                    displacement = sample_displacement(deltas, match)
                    if index in outer_mapping:
                        displacement = sample_displacement(deltas, outer_mapping[index]).lerp(displacement, region_mix[index])
                if match:
                    weight = target_weights[index]
                    output.data[index].co = output.data[index].co * (1 - weight) + (target_basis[index].co + inverse @ displacement * strength) * weight
        smooth_keys(result, smooth_iterations, smooth_strength, target_group, {key.name for key in selected_keys}, region_labels, unmatched)
        if anchors:
            for name, desired in desired_anchors.items():
                anchors.apply(result.data.shape_keys.key_blocks[name], desired, unmatched)
        apply_depth_corrections(result, target, depth_corrections, {key.name for key in selected_keys}, target_weights, unmatched)
        diagnostic_group = result.vertex_groups.get('SH3_Unmapped')
        if diagnostic_group:
            result.vertex_groups.remove(diagnostic_group)
        if unmatched:
            group = result.vertex_groups.new(name='SH3_Unmapped')
            group.add(unmatched, 1.0, 'REPLACE')
        result['sh3_morph_transfer'] = json.dumps({'source': source.name, 'keys': len(selected_keys),
            'matching': 'landmarks' if warp else 'surface', 'landmarks': len(landmarks[0]) if landmarks else 0,
            'protected_regions': [{'name': name, 'source': src, 'target': dst} for name, src, dst in regions],
            'region_coverage': [{'name': name, 'vertices': sum(x == region_id and target_weights[i] > 0 for i, x in enumerate(region_labels)),
                'unmatched': sum(region_labels[i] == region_id for i in unmatched)}
                for region_id, name in enumerate(['Whole surface'] + [r[0] for r in regions])],
            'motion': 'similarity', 'anchor_motion': len(landmark_indices), 'anchor_radius': anchors.radius if anchors else 0,
            'depth_corrections': [{'key': name, 'group': group, 'direction': list(direction), 'inward': inward, 'outward': outward}
                for name, group, direction, inward, outward in depth_corrections if name in {key.name for key in selected_keys}],
            'unmatched': len(unmatched), 'distance': max_distance, 'source_region': source_group, 'target_region': target_group, 'smoothing_iterations': smooth_iterations, 'smoothing_strength': smooth_strength})
    except Exception:
        data = result.data
        bpy.data.objects.remove(result, do_unlink=True)
        bpy.data.meshes.remove(data)
        raise
    return result, len(unmatched)


class SH3MorphRegion(bpy.types.PropertyGroup):
    name: StringProperty(name='Region', default='Surface region')
    source_group: StringProperty(name='Source group')
    target_group: StringProperty(name='Target group')


class SH3_UL_regions(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        layout.prop(item, 'name', text='', emboss=False)
        layout.label(text=f'{item.source_group or "?"} → {item.target_group or "?"}')


class SH3_OT_morph_region(bpy.types.Operator):
    bl_idname = 'sh3.morph_region'
    bl_label = 'Edit protected surface regions'
    bl_options = {'REGISTER', 'UNDO'}
    action: EnumProperty(items=[('ADD', 'Add', ''), ('REMOVE', 'Remove', '')])

    def execute(self, context):
        settings = context.scene.sh3_morph_transfer
        if self.action == 'ADD':
            settings.regions.add().name = 'Surface region ' + str(len(settings.regions))
            settings.region_index = len(settings.regions) - 1
        elif settings.regions:
            settings.regions.remove(settings.region_index)
            settings.region_index = max(0, min(settings.region_index, len(settings.regions) - 1))
        return {'FINISHED'}


class SH3MorphDepthCorrection(bpy.types.PropertyGroup):
    key_name: StringProperty(name='Morph')
    region_name: StringProperty(name='Protected region')
    inward: FloatProperty(name='Inward motion', default=1, min=0, max=2, subtype='FACTOR', description='1 keeps native backward motion; lower values reduce lip retraction')
    outward: FloatProperty(name='Outward motion', default=1, min=0, max=2, subtype='FACTOR', description='1 keeps native forward motion; lower values reduce protrusion')


class SH3MorphSettings(bpy.types.PropertyGroup):
    match_mode: EnumProperty(name='Matching', items=[('SURFACE', 'Aligned surfaces', 'Nearest neutral surface'), ('LANDMARKS', 'Paired landmarks', 'Smooth neutral alignment and displacement transfer through paired anchors')])
    landmarks: CollectionProperty(type=SH3MorphLandmark)
    regions: CollectionProperty(type=SH3MorphRegion)
    region_index: IntProperty(default=0, min=0)
    landmark_index: IntProperty(default=0, min=0)
    source: PointerProperty(name='Original morph mesh', type=bpy.types.Object, poll=mesh_object)
    target: PointerProperty(name='Replacement mesh', type=bpy.types.Object, poll=mesh_object)
    source_group: StringProperty(name='Source region', description='Optional group restricting matching triangles, useful for upper/lower lips')
    target_group: StringProperty(name='Target region', description='Optional vertex group controlling transferred displacement')
    max_distance: FloatProperty(name='Maximum distance', default=0, min=0, subtype='DISTANCE', description='World-space matching distance; zero uses 5% of the source size')
    strength: FloatProperty(name='Strength', default=1, min=0, max=4)
    smooth_iterations: IntProperty(name='Smoothing passes', default=3, min=0, max=50)
    smooth_strength: FloatProperty(name='Smoothing strength', default=.35, min=0, max=1, description='Smooth displacement only; zero disables smoothing')
    template: EnumProperty(name='Template', items=[('FACE', 'Face', 'Corners, lips and upper/lower eyelids'), ('HAIR', 'Hair / strand', 'Roots, intermediate points and tips'), ('CLOTH', 'Cloth / cloak', 'Shoulders, seams and hem')])
    show_landmarks: BoolProperty(name='Show labelled landmarks', default=True)
    show_region: BoolProperty(name='Show selected region', default=False)
    pin_landmarks: BoolProperty(name='Preserve landmark motion', default=True, description='Transfer captured landmark motion exactly and blend the correction locally along the surface')
    anchor_radius: FloatProperty(name='Landmark influence distance', default=0, min=0, subtype='DISTANCE', description='Geodesic correction radius. Zero uses 10% of the target bounds. Does not cross protected regions')
    feature: EnumProperty(name='Surface pair', items=[('MOUTH', 'Upper / lower lips', ''), ('LEFT_EYE', 'Left upper / lower eyelid', ''), ('RIGHT_EYE', 'Right upper / lower eyelid', '')])
    region_radius: FloatProperty(name='Region reach', default=1.4, min=.1, max=5, description='Distance along the target surface, in multiples of half the feature width')
    preview_key: StringProperty(name='Morph')
    preview_value: FloatProperty(name='Preview amount', default=1, min=0, max=1, update=lambda s,c: update_preview_value(s))
    preview_source: PointerProperty(type=bpy.types.Object)
    preview_result: PointerProperty(type=bpy.types.Object)
    preview_owner: StringProperty(options={'HIDDEN'})
    preview_signature: StringProperty(options={'HIDDEN'})
    depth_corrections: CollectionProperty(type=SH3MorphDepthCorrection)
    depth_index: IntProperty(default=0, min=0)


class SH3_OT_transfer_morphs(bpy.types.Operator):
    bl_idname = 'sh3.transfer_morphs'
    bl_label = 'Create transferred copy'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return context.mode == 'OBJECT'

    def execute(self, context):
        settings = context.scene.sh3_morph_transfer
        try:
            result, missing = transfer_settings(settings)
        except (ValueError, RuntimeError) as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}
        for obj in context.selected_objects:
            obj.select_set(False)
        result.hide_viewport = False
        result.hide_render = False
        result.hide_set(False)
        result.select_set(True)
        context.view_layer.objects.active = result
        self.report({'WARNING'} if missing else {'INFO'},
                    f'Created {result.name}. {missing} unmatched vertices; inspect every shape key before game import.')
        return {'FINISHED'}


class SH3_OT_smooth_morphs(bpy.types.Operator):
    bl_idname = 'sh3.smooth_morphs'
    bl_label = 'Smooth existing keys on a copy'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        return context.mode == 'OBJECT' and obj is not None and obj.type == 'MESH' and obj.data.shape_keys is not None

    def execute(self, context):
        source, settings = context.active_object, context.scene.sh3_morph_transfer
        result = source.copy()
        result.data = source.data.copy()
        result.name = source.name + '_SmoothMorphs'
        context.collection.objects.link(result)
        try:
            unmatched = [i for i, w in enumerate(weights(result, 'SH3_Unmapped')) if w > 0] if result.vertex_groups.get('SH3_Unmapped') else []
            smooth_keys(result, settings.smooth_iterations, settings.smooth_strength, settings.target_group,
                        regions=stored_region_labels(result), excluded=unmatched)
        except ValueError as error:
            data = result.data
            bpy.data.objects.remove(result, do_unlink=True)
            bpy.data.meshes.remove(data)
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}
        for obj in context.selected_objects:
            obj.select_set(False)
        result.select_set(True)
        context.view_layer.objects.active = result
        self.report({'INFO'}, 'Created ' + result.name + '. Review the shape keys before game import.')
        return {'FINISHED'}


LANDMARK_TEMPLATES = {
    'FACE': ('Left eye outer', 'Left eye inner', 'Left upper eyelid', 'Left lower eyelid',
             'Right eye inner', 'Right eye outer', 'Right upper eyelid', 'Right lower eyelid',
             'Nose tip', 'Mouth left', 'Mouth right', 'Upper lip', 'Lower lip', 'Chin'),
    'HAIR': ('Root left', 'Root center', 'Root right', 'Strand middle', 'Strand tip'),
    'CLOTH': ('Left shoulder', 'Right shoulder', 'Center seam', 'Left hem', 'Center hem', 'Right hem'),
}
FEATURES = {
    'MOUTH': ('Upper lip', 'Lower lip', 'Mouth left', 'Mouth right'),
    'LEFT_EYE': ('Left upper eyelid', 'Left lower eyelid', 'Left eye inner', 'Left eye outer'),
    'RIGHT_EYE': ('Right upper eyelid', 'Right lower eyelid', 'Right eye inner', 'Right eye outer'),
}


def capture_landmark(settings, side, vertex):
    obj = getattr(settings, side)
    obj.update_from_editmode()
    pair = settings.landmarks[settings.landmark_index]
    setattr(pair, side + '_vertex', vertex)
    setattr(pair, side + '_topology', topology_signature(obj))


def transfer_settings(settings, names=None):
    landmarks = paired_landmarks(settings)
    return transfer(settings.source, settings.target, settings.source_group, settings.target_group,
                    settings.max_distance, settings.strength, settings.smooth_iterations,
                    settings.smooth_strength, landmarks,
                    [(r.name, r.source_group, r.target_group) for r in settings.regions], names,
                    [(p.source_vertex, p.target_vertex) for p in settings.landmarks]
                    if landmarks and settings.pin_landmarks else (), settings.anchor_radius,
                    depth_correction_settings(settings, names))


def facial_forward(settings):
    names = ('Mouth left', 'Mouth right', 'Chin', 'Nose tip')
    if settings.target is None:
        raise ValueError('Choose a replacement mesh for facial depth correction.')
    points = basis_points(settings.target)
    signature = topology_signature(settings.target)
    anchors = []
    for name in names:
        pair = settings.landmarks.get(name)
        if pair is None or not 0 <= pair.target_vertex < len(points):
            raise ValueError('Facial depth needs target landmarks: mouth corners, chin and nose tip.')
        if pair.target_topology not in ('', signature):
            raise ValueError(f'{name}: target topology changed. Recapture before depth correction.')
        anchors.append(points[pair.target_vertex])
    left, right, chin, nose = anchors
    normal = (right - left).cross(chin - left)
    if normal.length_squared == 0:
        raise ValueError('Mouth corners and chin must form a plane for facial depth correction.')
    normal.normalize()
    distance = normal.dot(nose - left)
    if abs(distance) < 1e-6:
        raise ValueError('Nose tip must be in front of the mouth/chin plane.')
    return normal if distance > 0 else -normal


def depth_correction_settings(settings, names=None):
    active = [c for c in settings.depth_corrections if (names is None or c.key_name in names)]
    if not active:
        return ()
    direction = facial_forward(settings)
    corrections, used = [], set()
    for item in active:
        if not settings.source or not settings.source.data.shape_keys or item.key_name not in settings.source.data.shape_keys.key_blocks:
            raise ValueError(f'{item.key_name}: depth correction references a missing source morph.')
        region = settings.regions.get(item.region_name)
        if region is None or not region.target_group:
            raise ValueError(f'{item.key_name}: select a protected region for its depth correction.')
        identity = (item.key_name, item.region_name)
        if identity in used:
            raise ValueError(f'{item.key_name}: duplicate depth correction for {item.region_name}.')
        used.add(identity)
        corrections.append((item.key_name, region.target_group, direction, item.inward, item.outward))
    return corrections


def assign_region_group(obj, region, side, ids):
    owned = json.loads(obj.get('sh3_morph_region_groups', '[]'))
    name = getattr(region, side + '_group')
    group = obj.vertex_groups.get(name) if name in owned else None
    if group is None:
        group = obj.vertex_groups.new(name='SH3 ' + region.name + ' (' + side + ')')
        owned.append(group.name)
    else:
        group.remove(list(range(len(obj.data.vertices))))
    if isinstance(ids, dict):
        full = [i for i, weight in ids.items() if weight >= 1]
        if full:
            group.add(full, 1, 'REPLACE')
        for i, weight in ids.items():
            if 0 < weight < 1:
                group.add([i], weight, 'REPLACE')
    else:
        group.add(list(ids), 1, 'REPLACE')
    obj['sh3_morph_region_groups'] = json.dumps(owned)
    setattr(region, side + '_group', group.name)


def feather_region(obj, members, feature_members, width):
    """Blend only the outer skin boundary; the two protected rims keep full separation."""
    graph = surface_graph(obj)
    members, feature_members = set(members), set(feature_members)
    boundary = [i for i in members if any(j not in feature_members for j in graph[i])]
    distances = np.full(len(graph), np.inf)
    pending = [(0, i) for i in boundary]
    heapq.heapify(pending)
    distances[boundary] = 0
    while pending:
        cost, i = heapq.heappop(pending)
        if distances[i] != cost:
            continue
        for j, length in graph[i].items():
            if j in members and cost + length < min(distances[j], width):
                distances[j] = cost + length
                heapq.heappush(pending, (distances[j], j))
    values = np.minimum(distances / width, 1)
    values = values * values * (3 - 2 * values)
    return {i: float(values[i]) for i in members}


def suggest_feature_regions(settings):
    """Suggest inspectable surface partitions from four explicitly captured landmarks."""
    if settings.source is None or settings.target is None or settings.source == settings.target:
        raise ValueError('Choose different source and replacement meshes.')
    names = FEATURES[settings.feature]
    pairs = [settings.landmarks.get(name) for name in names]
    if any(pair is None for pair in pairs):
        raise ValueError('Add the Face template and capture: ' + ', '.join(names))
    partitions = {}
    target_width = 0
    for side in ('source', 'target'):
        obj = getattr(settings, side)
        obj.update_from_editmode()
        points = basis_points(obj)
        indices = [getattr(pair, side + '_vertex') for pair in pairs]
        if any(not 0 <= i < len(points) for i in indices):
            raise ValueError(f'Capture all four {side} landmarks for this surface pair.')
        signature = topology_signature(obj)
        if any(getattr(pair, side + '_topology') not in ('', signature) for pair in pairs):
            raise ValueError(f'{side.title()} topology changed. Recapture the feature landmarks.')
        upper, lower, left, right = indices
        graph = surface_graph(obj)
        if upper == lower or lower in graph[upper]:
            raise ValueError(f'{side.title()}: upper and lower points are on the same edge. Choose opposite rims of the opening.')
        width = (points[left] - points[right]).length
        if width <= 0:
            raise ValueError('Feature corners must be separate points.')
        distances = np.array([geodesic_distances(graph, i) for i in (upper, lower)])
        radius = width * .5 * settings.region_radius if side == 'target' else float('inf')
        partitions[side] = [np.flatnonzero((distances[n] < radius) &
                            (np.argmin(distances, axis=0) == n)).tolist() for n in (0, 1)]
        if side == 'source':
            # Both rim halves terminate at the same feature corners.
            partitions[side] = [sorted(set(ids) | {left, right}) for ids in partitions[side]]
        if not all(partitions[side]):
            raise ValueError(f'{side.title()}: the feature has no connected surface. Inspect its topology.')
        if side == 'target':
            target_width = width
    covered = set(partitions['target'][0] + partitions['target'][1])
    for region in settings.regions:
        if region.name not in names[:2] and region.target_group:
            if any(i in covered and v > 0 for i, v in enumerate(weights(settings.target, region.target_group))):
                raise ValueError(f'Suggested region overlaps {region.name}. Reduce Region reach or edit groups manually.')
    partitions['target'] = [feather_region(settings.target, ids, covered, target_width * .25)
                            for ids in partitions['target']]
    for n, name in enumerate(names[:2]):
        region = settings.regions.get(name)
        if region is None:
            region = settings.regions.add()
            region.name = name
        for side in ('source', 'target'):
            assign_region_group(getattr(settings, side), region, side, partitions[side][n])
    settings.show_region = True
    settings.region_index = next(i for i, r in enumerate(settings.regions) if r.name == names[0])


class SH3_OT_feature_regions(bpy.types.Operator):
    bl_idname = 'sh3.feature_regions'
    bl_label = 'Suggest regions from landmarks'
    bl_description = 'Create editable upper/lower surface groups from captured rim points; inspect the highlighted result'
    bl_options = {'REGISTER', 'UNDO'}

    @classmethod
    def poll(cls, context):
        return context.mode == 'OBJECT'

    def execute(self, context):
        try:
            suggest_feature_regions(context.scene.sh3_morph_transfer)
        except (ValueError, RuntimeError) as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}
        self.report({'INFO'}, 'Created editable regions. Inspect their coverage before previewing a morph.')
        return {'FINISHED'}


class SH3_OT_region_selection(bpy.types.Operator):
    bl_idname = 'sh3.region_selection'
    bl_label = 'Use selected vertices for region'
    bl_options = {'REGISTER', 'UNDO'}
    side: EnumProperty(items=[('source', 'Source', ''), ('target', 'Target', '')])

    def execute(self, context):
        s = context.scene.sh3_morph_transfer
        obj = getattr(s, self.side)
        if not s.regions or context.mode != 'EDIT_MESH' or context.active_object != obj:
            self.report({'ERROR'}, 'Choose a region, then select its vertices on the matching mesh in Edit Mode.')
            return {'CANCELLED'}
        region = s.regions[min(s.region_index, len(s.regions) - 1)]
        bm = bmesh.from_edit_mesh(obj.data)
        bm.verts.index_update()
        bm.verts.ensure_lookup_table()
        ids = [v.index for v in bm.verts if v.select]
        if not ids:
            self.report({'ERROR'}, 'Select the vertices to include. For the source, include complete faces.')
            return {'CANCELLED'}
        bpy.ops.object.mode_set(mode='OBJECT')
        try:
            if self.side == 'target':
                for other in s.regions:
                    if other != region and other.target_group:
                        mask = weights(obj, other.target_group)
                        if any(mask[i] > 0 for i in ids):
                            raise ValueError('Selection overlaps ' + other.name + '. Protected target groups must be separate.')
            assign_region_group(obj, region, self.side, ids)
        except (ValueError, RuntimeError) as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}
        finally:
            bpy.ops.object.mode_set(mode='EDIT')
        return {'FINISHED'}


def remove_owned_preview(obj, owner):
    if obj is not None and obj.get('sh3_morph_preview') == owner:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)


def discard_preview(settings):
    source, target = settings.preview_source, settings.preview_result
    settings.preview_source = settings.preview_result = None
    for obj in (source, target):
        remove_owned_preview(obj, settings.preview_owner)
    settings.preview_signature = ''


def update_preview_value(settings):
    for obj in (settings.preview_source, settings.preview_result):
        if obj and obj.get('sh3_morph_preview') == settings.preview_owner and obj.data.shape_keys:
            name = obj['sh3_preview_key']
            for key in obj.data.shape_keys.key_blocks:
                key.value = settings.preview_value if key.name == name else 0


def preview_signature(settings):
    fields = ('match_mode', 'preview_key', 'source_group', 'target_group', 'max_distance',
              'strength', 'smooth_iterations', 'smooth_strength', 'pin_landmarks', 'anchor_radius')
    return json.dumps([*[getattr(settings, f) for f in fields],
        [(getattr(settings, side).name if getattr(settings, side) else '') for side in ('source', 'target')],
        [(p.name, p.source_vertex, p.target_vertex) for p in settings.landmarks],
        [(r.name, r.source_group, r.target_group) for r in settings.regions],
        [(c.key_name, c.region_name, c.inward, c.outward) for c in settings.depth_corrections]])


class SH3_UL_depth_corrections(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_propname, index):
        layout.label(text=item.key_name)
        layout.label(text=item.region_name or 'Choose region')


class SH3_OT_depth_correction(bpy.types.Operator):
    bl_idname = 'sh3.depth_correction'
    bl_label = 'Adjust facial depth'
    bl_options = {'REGISTER', 'UNDO'}
    action: EnumProperty(items=[('ADD', 'Add current morph', ''), ('REMOVE', 'Remove', '')])

    def execute(self, context):
        s = context.scene.sh3_morph_transfer
        if self.action == 'REMOVE':
            if s.depth_corrections:
                s.depth_corrections.remove(min(s.depth_index, len(s.depth_corrections) - 1))
                s.depth_index = max(0, min(s.depth_index, len(s.depth_corrections) - 1))
            return {'FINISHED'}
        if s.source is None or not s.source.data.shape_keys or s.preview_key not in s.source.data.shape_keys.key_blocks or s.preview_key == s.source.data.shape_keys.reference_key.name:
            self.report({'ERROR'}, 'Select a source morph to preview first.')
            return {'CANCELLED'}
        item = s.depth_corrections.add()
        item.key_name = s.preview_key
        if s.regions:
            item.region_name = s.regions[min(s.region_index, len(s.regions) - 1)].name
        s.depth_index = len(s.depth_corrections) - 1
        return {'FINISHED'}


def create_preview(settings):
    source = settings.source
    if source is None or not source.data.shape_keys or len(source.data.shape_keys.key_blocks) < 2:
        raise ValueError('Choose the original mesh with morphs.')
    if not settings.preview_key:
        settings.preview_key = source.data.shape_keys.key_blocks[1].name
    result, missing = transfer_settings(settings, {settings.preview_key})
    reference = None
    try:
        reference = source.copy()
        reference.data = source.data.copy()
        bpy.context.collection.objects.link(reference)
        import uuid
        owner = settings.preview_owner or uuid.uuid4().hex
        target_points = np.array(basis_points(settings.target))
        center = (target_points.min(axis=0) + target_points.max(axis=0)) * .5
        width = max(float(np.ptp(target_points, axis=0)[0]), float(np.linalg.norm(np.ptp(target_points, axis=0))) * .4)
        for n, obj in enumerate((reference, result)):
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            obj.animation_data_clear()
            obj.data.shape_keys.animation_data_clear()
            obj.modifiers.clear()
            obj.show_only_shape_key = False
            obj.use_shape_key_edit_mode = False
            obj.active_shape_key_index = list(obj.data.shape_keys.key_blocks.keys()).index(settings.preview_key)
            obj.hide_viewport = False
            obj.hide_render = True
            obj.hide_set(False)
            obj['sh3_morph_preview'] = owner
            obj['sh3_preview_key'] = settings.preview_key
            obj.name = 'SH3 Preview — ' + ('Original' if n == 0 else 'Replacement')
            positions = np.array(basis_points(obj))
            midpoint = (positions.min(axis=0) + positions.max(axis=0)) * .5
            obj.location += Vector(center - midpoint + np.array([width * (2 + 1.3 * n), 0, 0]))
        discard_preview(settings)
        settings.preview_owner = owner
        settings.preview_source, settings.preview_result = reference, result
        settings.preview_signature = preview_signature(settings)
        update_preview_value(settings)
        bpy.context.view_layer.update()
        return result, missing
    except Exception:
        for obj in (reference, result):
            if obj:
                data = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                if data.users == 0:
                    bpy.data.meshes.remove(data)
        raise


def frame_objects(context, objects):
    if context.area is None or context.area.type != 'VIEW_3D':
        return
    points = [p for obj in objects if obj for p in basis_points(obj)]
    if not points:
        return
    values = np.array(points)
    minimum, maximum = values.min(axis=0), values.max(axis=0)
    view = context.space_data.region_3d
    view.view_location = Vector((minimum + maximum) * .5)
    view.view_distance = max(float(np.linalg.norm(maximum - minimum)) * 1.4, .01)
    context.area.tag_redraw()


class SH3_OT_morph_preview(bpy.types.Operator):
    bl_idname = 'sh3.morph_preview'
    bl_label = 'Preview selected morph'
    bl_options = {'REGISTER', 'UNDO'}
    action: EnumProperty(items=[(x, x, '') for x in ('UPDATE', 'DISCARD', 'FRAME', 'PREVIOUS', 'NEXT')])

    @classmethod
    def poll(cls, context):
        return context.mode == 'OBJECT'

    def execute(self, context):
        s = context.scene.sh3_morph_transfer
        try:
            if self.action == 'DISCARD':
                discard_preview(s)
                return {'FINISHED'}
            if self.action == 'FRAME':
                frame_objects(context, [s.preview_source, s.preview_result])
                return {'FINISHED'}
            if self.action in {'PREVIOUS', 'NEXT'}:
                if s.source is None or not s.source.data.shape_keys:
                    raise ValueError('Choose the original mesh with morphs.')
                names = [k.name for k in list(s.source.data.shape_keys.key_blocks)[1:]]
                if not names:
                    raise ValueError('The original mesh needs at least one morph besides Basis.')
                index = names.index(s.preview_key) if s.preview_key in names else 0
                s.preview_key = names[(index + (-1 if self.action == 'PREVIOUS' else 1)) % len(names)]
            result, missing = create_preview(s)
        except (ValueError, RuntimeError) as error:
            self.report({'ERROR'}, str(error))
            return {'CANCELLED'}
        frame_objects(context, [s.preview_source, result])
        self.report({'WARNING'} if missing else {'INFO'}, f'{s.preview_key}: {missing} unmatched vertices. Original left; replacement right.')
        return {'FINISHED'}


class SH3_OT_morph_mesh(bpy.types.Operator):
    bl_idname = 'sh3.morph_mesh'
    bl_label = 'Show morph mesh'
    bl_options = {'REGISTER', 'UNDO'}
    side: EnumProperty(items=[('source', 'Source', ''), ('target', 'Target', '')])
    action: EnumProperty(items=[('SET', 'Use active mesh', ''), ('SHOW', 'Select and frame', '')])

    def execute(self, context):
        s = context.scene.sh3_morph_transfer
        if self.action == 'SET':
            obj = context.active_object
            if obj is None or obj.type != 'MESH' or obj.get('sh3_morph_preview'):
                self.report({'ERROR'}, 'Select an original authoring mesh, not a temporary preview.')
                return {'CANCELLED'}
            setattr(s, self.side, obj)
            return {'FINISHED'}
        obj = getattr(s, self.side)
        if obj is None:
            return {'CANCELLED'}
        if context.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        for other in context.selected_objects:
            other.select_set(False)
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        frame_objects(context, [obj])
        return {'FINISHED'}


class SH3_OT_pick_landmark(bpy.types.Operator):
    bl_idname = 'sh3.pick_landmark'
    bl_label = 'Pick neutral landmark'
    bl_description = 'Click a vertex on the chosen mesh; its neutral Basis is shown temporarily. Esc cancels'
    bl_options = {'REGISTER', 'UNDO'}
    side: EnumProperty(items=[('source', 'Source', ''), ('target', 'Target', '')])

    def invoke(self, context, event):
        s = context.scene.sh3_morph_transfer
        self.obj = getattr(s, self.side)
        if context.mode != 'OBJECT' or not s.landmarks or self.obj is None or context.area.type != 'VIEW_3D':
            self.report({'ERROR'}, 'Choose a landmark and mesh, then pick in Object Mode.')
            return {'CANCELLED'}
        if not self.obj.visible_get():
            self.report({'ERROR'}, 'Use Select / frame to show this mesh before picking.')
            return {'CANCELLED'}
        self.points = basis_points(self.obj)
        self.obj.data.calc_loop_triangles()
        self.triangles = [tuple(t.vertices) for t in self.obj.data.loop_triangles]
        if not self.triangles:
            self.report({'ERROR'}, 'The mesh has no surface to pick.')
            return {'CANCELLED'}
        self.tree = BVHTree.FromPolygons(self.points, self.triangles, all_triangles=True)
        self.old_key = self.obj.active_shape_key_index
        self.old_only = self.obj.show_only_shape_key
        self.modifiers = [(m, m.show_viewport) for m in self.obj.modifiers]
        self.obj.active_shape_key_index = 0
        self.obj.show_only_shape_key = True
        for modifier, _ in self.modifiers:
            modifier.show_viewport = False
        self.area = context.area
        self.area.header_text_set('Pick ' + self.side + ': ' + s.landmarks[s.landmark_index].name + ' — click neutral surface; Esc cancels')
        context.window.cursor_modal_set('CROSSHAIR')
        context.window_manager.modal_handler_add(self)
        return {'RUNNING_MODAL'}

    def finish(self, context):
        self.obj.active_shape_key_index = self.old_key
        self.obj.show_only_shape_key = self.old_only
        for modifier, visible in self.modifiers:
            modifier.show_viewport = visible
        self.area.header_text_set(None)
        self.area.tag_redraw()
        context.window.cursor_modal_restore()

    def cancel(self, context):
        self.finish(context)

    def modal(self, context, event):
        if event.type in {'ESC', 'RIGHTMOUSE'}:
            self.finish(context)
            return {'CANCELLED'}
        if event.type == 'LEFTMOUSE' and event.value == 'PRESS':
            from bpy_extras import view3d_utils
            region = next(r for r in self.area.regions if r.type == 'WINDOW')
            xy = (event.mouse_x - region.x, event.mouse_y - region.y)
            if not (0 <= xy[0] < region.width and 0 <= xy[1] < region.height):
                return {'RUNNING_MODAL'}
            view = self.area.spaces.active.region_3d
            origin = view3d_utils.region_2d_to_origin_3d(region, view, xy)
            direction = view3d_utils.region_2d_to_vector_3d(region, view, xy)
            hit, _, face, _ = self.tree.ray_cast(origin, direction)
            if hit is not None:
                vertex = min(self.triangles[face], key=lambda i: (self.points[i] - hit).length_squared)
                capture_landmark(context.scene.sh3_morph_transfer, self.side, vertex)
                self.finish(context)
                self.report({'INFO'}, f'Captured {self.side} vertex {vertex}.')
                return {'FINISHED'}
        return {'PASS_THROUGH'}


class SH3_OT_select_unmapped(bpy.types.Operator):
    bl_idname = 'sh3.select_unmapped'
    bl_label = 'Select unmatched vertices'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        s = context.scene.sh3_morph_transfer
        obj = s.preview_result
        if obj is None or context.mode != 'OBJECT':
            self.report({'ERROR'}, 'Create a preview and return to Object Mode.')
            return {'CANCELLED'}
        for other in context.selected_objects:
            other.select_set(False)
        obj.hide_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        group = obj.vertex_groups.get('SH3_Unmapped')
        for vertex in obj.data.vertices:
            vertex.select = group is not None and any(g.group == group.index and g.weight > 0 for g in vertex.groups)
        bpy.ops.object.mode_set(mode='EDIT')
        context.tool_settings.mesh_select_mode = (True, False, False)
        return {'FINISHED'}


_DRAW_HANDLERS = []
SIDE_COLORS = {'source': (.2, .8, 1, 1), 'target': (1, .55, .15, 1)}


def draw_landmark_labels():
    import blf
    from bpy_extras.view3d_utils import location_3d_to_region_2d
    context = bpy.context
    if context.region_data is None or not hasattr(context.scene, 'sh3_morph_transfer'):
        return
    s = context.scene.sh3_morph_transfer
    if not s.show_landmarks:
        return
    blf.size(0, 12)
    for side in ('source', 'target'):
        obj = getattr(s, side)
        if obj is None or not obj.visible_get():
            continue
        points = basis_points(obj)
        blf.color(0, *SIDE_COLORS[side])
        for n, pair in enumerate(s.landmarks):
            index = getattr(pair, side + '_vertex')
            if not 0 <= index < len(points):
                continue
            pos = location_3d_to_region_2d(context.region, context.region_data, points[index])
            if pos is not None:
                label = f'{side[0].upper()}{n + 1}' + (' ' + pair.name if n == s.landmark_index else '')
                blf.position(0, pos.x + 7, pos.y + (7 if side == 'source' else -15), 0)
                blf.draw(0, label)


def draw_surface_points():
    import gpu
    from gpu_extras.batch import batch_for_shader
    context = bpy.context
    if not hasattr(context.scene, 'sh3_morph_transfer'):
        return
    s = context.scene.sh3_morph_transfer
    shader = gpu.shader.from_builtin('UNIFORM_COLOR')
    def dots(points, color, size):
        if points:
            gpu.state.point_size_set(size)
            shader.bind()
            shader.uniform_float('color', color)
            batch_for_shader(shader, 'POINTS', {'pos': points}).draw(shader)
    try:
        for side in ('source', 'target'):
            obj = getattr(s, side)
            if obj is None or not obj.visible_get():
                continue
            points = basis_points(obj)
            if s.show_region and s.regions:
                region = s.regions[min(s.region_index, len(s.regions) - 1)]
                name = getattr(region, side + '_group')
                if name and obj.vertex_groups.get(name):
                    dots([points[i] for i, w in enumerate(weights(obj, name)) if w > 0], SIDE_COLORS[side], 3)
            if s.show_landmarks:
                ids = [getattr(p, side + '_vertex') for p in s.landmarks]
                dots([points[i] for i in ids if 0 <= i < len(points)], SIDE_COLORS[side], 8)
        obj = s.preview_result
        if obj and obj.visible_get() and obj.vertex_groups.get('SH3_Unmapped'):
            key = obj.data.shape_keys.key_blocks[obj['sh3_preview_key']]
            base = obj.data.shape_keys.reference_key
            points = [obj.matrix_world @ (b.co + (k.co - b.co) * s.preview_value) for b, k in zip(base.data, key.data)]
            dots([points[i] for i, w in enumerate(weights(obj, 'SH3_Unmapped')) if w > 0], (1, .15, .6, 1), 4)
    finally:
        gpu.state.point_size_set(1)


class SH3MorphPanel:
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'SH3 Tools'


class SH3_PT_morph_transfer(SH3MorphPanel, bpy.types.Panel):
    bl_label = 'Pose Morph Transfer'
    bl_idname = 'SH3_PT_morph_transfer'

    def draw(self, context):
        pass


class SH3_PT_morph_meshes(SH3MorphPanel, bpy.types.Panel):
    bl_label = '1. Meshes'
    bl_idname = 'SH3_PT_morph_meshes'
    bl_parent_id = 'SH3_PT_morph_transfer'
    bl_order = 0

    def draw(self, context):
        layout, settings = self.layout, context.scene.sh3_morph_transfer
        for side in ('source', 'target'):
            layout.prop(settings, side)
            row = layout.row(align=True)
            for action, title in [('SET', 'Use active'), ('SHOW', 'Select / frame')]:
                op = row.operator('sh3.morph_mesh', text=title)
                op.side, op.action = side, action
        layout.prop(settings, 'match_mode')
        layout.label(text='Basis coordinates; modifiers are not baked.', icon='INFO')


class SH3_PT_landmark_setup(SH3MorphPanel, bpy.types.Panel):
    bl_order = 1
    bl_idname = 'SH3_PT_landmark_setup'
    bl_parent_id = 'SH3_PT_morph_transfer'
    bl_label = '2. Corresponding points'

    def draw(self, context):
        layout, s = self.layout, context.scene.sh3_morph_transfer
        row = layout.row(align=True)
        row.prop(s, 'template', text='')
        row.operator('sh3.landmark', text='Add template').action = 'TEMPLATE'
        layout.prop(s, 'show_landmarks')
        layout.label(text='Neutral points: source cyan / target orange')
        layout.template_list('SH3_UL_landmarks', '', s, 'landmarks', s, 'landmark_index', rows=4)
        row = layout.row(align=True)
        row.operator('sh3.landmark', text='Add point', icon='ADD').action = 'ADD'
        row.operator('sh3.landmark', text='Remove', icon='REMOVE').action = 'REMOVE'
        if s.landmarks:
            layout.label(text=s.landmarks[min(s.landmark_index, len(s.landmarks) - 1)].name)
            row = layout.row(align=True)
            for side in ('source', 'target'):
                row.operator('sh3.pick_landmark', text='Pick ' + side).side = side
            row = layout.row(align=True)
            for side in ('SOURCE', 'TARGET'):
                row.operator('sh3.landmark', text='Capture ' + side.lower()).action = side
        layout.label(text='Pick: click the neutral mesh; Esc cancels.')
        layout.label(text='Capture: one selected vertex in Edit Mode.')
        layout.label(text='Lips / eyelids: opposite rims, not nearby rows.')
        complete = sum(p.source_vertex >= 0 and p.target_vertex >= 0 for p in s.landmarks)
        layout.label(text=f'{complete} / {len(s.landmarks)} pairs captured')
        if s.match_mode == 'LANDMARKS':
            layout.prop(s, 'pin_landmarks')
            if s.pin_landmarks:
                layout.prop(s, 'anchor_radius')


class SH3_PT_protected_regions(SH3MorphPanel, bpy.types.Panel):
    bl_order = 2
    bl_idname = 'SH3_PT_protected_regions'
    bl_parent_id = 'SH3_PT_morph_transfer'
    bl_label = '3. Protect overlapping surfaces'
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, context):
        layout, settings = self.layout, context.scene.sh3_morph_transfer
        layout.prop(settings, 'show_region')
        layout.template_list('SH3_UL_regions', '', settings, 'regions', settings, 'region_index', rows=3)
        row = layout.row(align=True)
        row.operator('sh3.morph_region', text='Add pair').action = 'ADD'
        row.operator('sh3.morph_region', text='Remove pair').action = 'REMOVE'
        if settings.regions:
            region = settings.regions[min(settings.region_index, len(settings.regions) - 1)]
            for field, obj in [('source_group', settings.source), ('target_group', settings.target)]:
                if obj:
                    layout.prop_search(region, field, obj, 'vertex_groups')
            row = layout.row(align=True)
            for side in ('source', 'target'):
                row.operator('sh3.region_selection', text='Set ' + side + ' selection').side = side
        layout.label(text='Target groups must not overlap.')
        box = layout.box()
        box.label(text='Face helper — editable suggestions')
        box.prop(settings, 'feature', text='')
        box.prop(settings, 'region_radius')
        box.operator('sh3.feature_regions')
        box.label(text='Capture corners and both rims first.')


class SH3_PT_transfer_settings(SH3MorphPanel, bpy.types.Panel):
    bl_order = 3
    bl_idname = 'SH3_PT_transfer_settings'
    bl_parent_id = 'SH3_PT_morph_transfer'
    bl_label = 'Transfer settings'
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, context):
        layout, settings = self.layout, context.scene.sh3_morph_transfer
        for field, obj in [('source_group', settings.source), ('target_group', settings.target)]:
            if obj:
                layout.prop_search(settings, field, obj, 'vertex_groups')
        layout.prop(settings, 'max_distance')
        layout.prop(settings, 'strength')
        layout.prop(settings, 'smooth_iterations')
        layout.prop(settings, 'smooth_strength')
        layout.operator('sh3.smooth_morphs')


class SH3_PT_morph_preview(SH3MorphPanel, bpy.types.Panel):
    bl_order = 4
    bl_idname = 'SH3_PT_morph_preview'
    bl_parent_id = 'SH3_PT_morph_transfer'
    bl_label = '4. Preview, then create'

    def draw(self, context):
        layout, s = self.layout, context.scene.sh3_morph_transfer
        if s.source and s.source.data.shape_keys:
            layout.prop_search(s, 'preview_key', s.source.data.shape_keys, 'key_blocks')
        row = layout.row(align=True)
        row.operator('sh3.morph_preview', text='', icon='TRIA_LEFT').action = 'PREVIOUS'
        row.operator('sh3.morph_preview', text='Preview / update', icon='HIDE_OFF').action = 'UPDATE'
        row.operator('sh3.morph_preview', text='', icon='TRIA_RIGHT').action = 'NEXT'
        if s.preview_result:
            layout.prop(s, 'preview_value', slider=True)
            layout.label(text='Original left / replacement right')
            if s.preview_signature != preview_signature(s):
                layout.label(text='Settings changed — update preview', icon='ERROR')
            layout.label(text='After editing mesh or groups, update preview.')
            metadata = json.loads(s.preview_result.get('sh3_morph_transfer', '{}'))
            box = layout.box()
            box.label(text=f'{metadata.get("unmatched", 0)} unmatched vertices', icon='INFO')
            box.label(text='Matched / active vertices')
            for region in metadata.get('region_coverage', []):
                box.label(text=f'{region["name"]}: {region["vertices"] - region["unmatched"]} / {region["vertices"]}')
            row = layout.row(align=True)
            row.operator('sh3.morph_preview', text='Frame previews').action = 'FRAME'
            row.operator('sh3.morph_preview', text='Remove previews').action = 'DISCARD'
            layout.operator('sh3.select_unmapped', text='Select unmatched vertices')
        layout.separator()
        layout.operator('sh3.transfer_morphs', text='Create all morphs on a new copy', icon='SHAPEKEY_DATA')
        layout.label(text='Review every key before game import.')
        layout.label(text='Temporary previews are not the final model.')


class SH3_PT_morph_depth(SH3MorphPanel, bpy.types.Panel):
    bl_order = 0
    bl_idname = 'SH3_PT_morph_depth'
    bl_parent_id = 'SH3_PT_morph_preview'
    bl_label = 'Facial depth corrections'
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, context):
        layout, s = self.layout, context.scene.sh3_morph_transfer
        layout.label(text='Reduce lip retraction for one morph.')
        layout.template_list('SH3_UL_depth_corrections', '', s, 'depth_corrections', s, 'depth_index', rows=2)
        row = layout.row(align=True)
        row.operator('sh3.depth_correction', text='Add current morph').action = 'ADD'
        row.operator('sh3.depth_correction', text='Remove').action = 'REMOVE'
        if s.depth_corrections:
            item = s.depth_corrections[min(s.depth_index, len(s.depth_corrections) - 1)]
            if s.source and s.source.data.shape_keys:
                layout.prop_search(item, 'key_name', s.source.data.shape_keys, 'key_blocks')
            layout.prop_search(item, 'region_name', s, 'regions')
            layout.prop(item, 'inward', slider=True)
            layout.prop(item, 'outward', slider=True)
        layout.label(text='Direction: mouth corners, chin, nose.')
        layout.label(text='1 = original motion; 0 = no depth motion.')
        layout.label(text='Click Preview / update after adjusting.')


CLASSES = (SH3MorphLandmark, SH3_UL_landmarks, SH3_OT_landmark, SH3MorphRegion, SH3_UL_regions,
           SH3_OT_morph_region, SH3MorphDepthCorrection, SH3MorphSettings, SH3_OT_transfer_morphs, SH3_OT_smooth_morphs,
           SH3_OT_feature_regions, SH3_OT_region_selection, SH3_OT_morph_preview, SH3_OT_morph_mesh,
           SH3_OT_pick_landmark, SH3_OT_select_unmapped, SH3_PT_morph_transfer, SH3_PT_morph_meshes,
           SH3_PT_landmark_setup,
           SH3_PT_protected_regions, SH3_PT_transfer_settings, SH3_PT_morph_preview,
           SH3_UL_depth_corrections, SH3_OT_depth_correction, SH3_PT_morph_depth)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.sh3_morph_transfer = PointerProperty(type=SH3MorphSettings)
    if not bpy.app.background:
        _DRAW_HANDLERS.append(bpy.types.SpaceView3D.draw_handler_add(draw_landmark_labels, (), 'WINDOW', 'POST_PIXEL'))
        _DRAW_HANDLERS.append(bpy.types.SpaceView3D.draw_handler_add(draw_surface_points, (), 'WINDOW', 'POST_VIEW'))


def unregister():
    for handler in _DRAW_HANDLERS:
        bpy.types.SpaceView3D.draw_handler_remove(handler, 'WINDOW')
    _DRAW_HANDLERS.clear()
    del bpy.types.Scene.sh3_morph_transfer
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == '__main__':
    register()
