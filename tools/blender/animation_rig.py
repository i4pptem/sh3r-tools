"""Map evaluated Blender poses to the original SH3 bone identities and local axes."""
import math

import bpy
from exchange_progress import frames as progress_frames
from mathutils import Matrix, Quaternion, Vector

PROPERTY = 'sh3_anm_exchange'
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def matrix(values):
    return Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()


def row_matrix(values):
    return Matrix([values[i:i + 4] for i in range(0, 16, 4)])


def armature(metadata=None):
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    marked = [obj for obj in rigs if obj.get(PROPERTY)]
    if len(marked) == 1:
        return marked[0]
    if metadata:
        names = {bone['name'] for bone in metadata['bones']}
        rigs = [obj for obj in rigs if names.issubset(obj.data.bones.keys())]
    if len(rigs) != 1:
        raise ValueError('Select one original SH3 armature for animation exchange. Other control rigs may remain in the scene; keep the SH3 custom property on the game rig only.')
    return rigs[0]


def bind_signature(rig, metadata):
    return {'object': [v for row in rig.matrix_world for v in row],
            'bones': [[v for row in rig.data.bones[bone['name']].matrix_local for v in row] for bone in metadata['bones']]}


def normalized_position(value, scale):
    result = value.copy()
    result.translation /= scale
    return result


def check_bind(rig, metadata):
    names = {bone['name'] for bone in metadata['bones']}
    missing = names.difference(rig.data.bones.keys())
    if missing:
        raise ValueError('Missing original bones: ' + ', '.join(sorted(missing)) + '. Restore their original names; extra control bones are allowed.')
    actual = [rig.data.bones[bone['name']].matrix_local.copy() for bone in metadata['bones']]
    expected = [row_matrix(value) for value in metadata['fbxBind']['bones']]
    denominator = sum(value.translation.length_squared for value in expected)
    scale = sum(a.translation.dot(b.translation) for a, b in zip(actual, expected)) / denominator if denominator else 1.0
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('The rest skeleton has a mirrored or invalid scale. Use positive uniform armature scale; keep the original rest bones.')
    for index, bone in enumerate(metadata['bones']):
        native = rig.data.bones[bone['name']]
        parent = native.parent
        while parent and parent.name not in names:
            parent = parent.parent
        wanted = metadata['bones'][bone['parent']]['name'] if bone['parent'] >= 0 else None
        if (parent.name if parent else None) != wanted:
            raise ValueError(f"{bone['name']}: original bone hierarchy changed. Restore parent {wanted or '(root)'}; helper bones can be inserted without changing the original bone ancestry.")
        current = normalized_position(actual[index], scale)
        for row in range(4):
            for col in range(4):
                limit = 1 / 32 if col == 3 and row < 3 else 1 / 8192
                if not math.isfinite(current[row][col]) or abs(current[row][col] - expected[index][row][col]) >= limit:
                    raise ValueError(f"{bone['name']}: rest-pose {'position' if col == 3 else 'axes'} changed. Pose Mode animation is supported; restore this bone in Edit Mode. Uniform object/applied scale is normalized automatically.")
    return scale


def frame_range(rig, metadata):
    objects, pending = set(), [rig]
    while pending:
        obj = pending.pop()
        if obj in objects:
            continue
        objects.add(obj)
        constraints = list(obj.constraints)
        if obj.type == 'ARMATURE':
            constraints += [constraint for bone in obj.pose.bones for constraint in bone.constraints]
        pending.extend(constraint.target for constraint in constraints if getattr(constraint, 'target', None))
    if metadata.get('morph'):
        names = {binding['name'] for binding in metadata['morph']['bindings']}
        objects.update(obj.data.shape_keys for obj in bpy.context.scene.objects
                       if obj.type == 'MESH' and obj.get('sh3_morph_mesh') in names and obj.data.shape_keys)
    ranges = []
    for obj in objects:
        animation = obj.animation_data
        if not animation:
            continue
        if animation.action:
            ranges.append(tuple(animation.action.frame_range))
        ranges.extend((strip.frame_start, strip.frame_end) for track in animation.nla_tracks if not track.mute for strip in track.strips if not strip.mute)
    first = min(value[0] for value in ranges) if ranges else 0
    last = max(value[1] for value in ranges) if ranges else metadata['end'] - metadata['start']
    first, last = math.floor(first + 1e-4), math.ceil(last - 1e-4)
    if (last - first + 1) * len(metadata['bones']) > 500000:
        raise ValueError('Animation exceeds 500,000 bone samples. Export a shorter action or trim its frame range.')
    return first, last


def sample(rig, metadata, first=None, last=None):
    scale = check_bind(rig, metadata)
    if first is None:
        first, last = frame_range(rig, metadata)
    bones = metadata['bones']
    expected_object = row_matrix(metadata['fbxBind']['object'])
    reference = [row_matrix(value) for value in metadata['fbxBind']['bones']]
    corrections = [(expected_object @ reference[i]).inverted() @ TO_BLENDER @ matrix(bone['world']) for i, bone in enumerate(bones)]
    rest = [reference[bone['parent']].inverted() @ reference[i] if bone['parent'] >= 0 else reference[i] for i, bone in enumerate(bones)]
    samples = []
    for frame in progress_frames(first, last, 'Sampling skeleton · ' + rig.name):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
        worlds = [normalized_position(evaluated.pose.bones[bone['name']].matrix, scale) for bone in bones]
        poses = []
        for i, bone in enumerate(bones):
            local = worlds[bone['parent']].inverted() @ worlds[i] if bone['parent'] >= 0 else worlds[i]
            # Read evaluated IK/constraints, then discard unsupported local Scale.
            location, rotation, _scale = (rest[i].inverted() @ local).decompose()
            local = rest[i] @ Matrix.LocRotScale(location, rotation, Vector((1, 1, 1))) @ corrections[i]
            local = corrections[bone['parent']].inverted() @ local if bone['parent'] >= 0 else TO_BLENDER.inverted() @ expected_object @ local
            position, rotation, _scale = local.decompose()
            values = list(position) + list(rotation)
            if not all(math.isfinite(value) for value in values):
                raise ValueError(f"{bone['name']}, source frame {frame}: invalid evaluated transform. Check the IK target, constraints and scene units.")
            poses.append({'translation': list(position), 'rotation': [rotation.x, rotation.y, rotation.z, rotation.w]})
        samples.append(poses)
    ignored = sorted(set(rig.data.bones.keys()).difference(bone['name'] for bone in bones))
    return samples, {'sourceStart': first, 'sourceEnd': last, 'ignoredBones': ignored, 'normalizedRestScale': scale,
                     'objectPlacementIgnored': True, 'fps': bpy.context.scene.render.fps / bpy.context.scene.render.fps_base}
