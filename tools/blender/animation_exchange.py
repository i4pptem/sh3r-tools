import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix

PROPERTY = 'sh3_anm_exchange'
# glTF Y-up coordinates to Blender Z-up coordinates.
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def matrix(values):
    return Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()


def armature():
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError('Keep exactly one original armature in the FBX.')
    return rigs[0]


def import_fbx(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(file), use_custom_props=True, anim_offset=0.0,
                             automatic_bone_orientation=False, ignore_leaf_bones=False)
    return armature()


def bind_signature(rig, metadata):
    return {'object': [v for row in rig.matrix_world for v in row],
            'bones': [[v for row in rig.data.bones[bone['name']].matrix_local for v in row] for bone in metadata['bones']]}


def check_bind(rig, metadata):
    actual = bind_signature(rig, metadata)
    expected = metadata['fbxBind']
    for current, original in zip([actual['object']] + actual['bones'], [expected['object']] + expected['bones']):
        if any(abs(a - b) >= (1 / 32 if i in (3, 7, 11) else 1 / 8192) for i, (a, b) in enumerate(zip(current, original))):
            raise ValueError('FBX rest skeleton changed. Edit the action in Pose Mode; keep the original rest bones and armature transform.')


def sample(rig, metadata):
    bones = metadata['bones']
    if set(rig.data.bones.keys()) != {bone['name'] for bone in bones}:
        raise ValueError('Keep all original bone names. Export FBX with Add Leaf Bones disabled.')
    rest = []
    for bone in bones:
        native = rig.data.bones[bone['name']]
        parent = bones[bone['parent']]['name'] if bone['parent'] >= 0 else None
        if (native.parent.name if native.parent else None) != parent:
            raise ValueError(f"Skeleton hierarchy changed at {bone['name']}.")
        rest.append((rig.matrix_world @ native.matrix_local).inverted())
    count = metadata['end'] - metadata['start'] + 1
    if not rig.animation_data or not rig.animation_data.action:
        raise ValueError('FBX contains no active armature action.')
    first, last = rig.animation_data.action.frame_range
    if abs(first) > 1e-4 or abs(last - (count - 1)) > 1e-4:
        raise ValueError(f'Keep FBX frames 0 through {count - 1}; ANM action ranges cannot change length.')
    inverse = TO_BLENDER.inverted()
    corrections = [rest[i] @ TO_BLENDER @ matrix(bone['world']) for i, bone in enumerate(bones)]
    local_rest = []
    for bone in bones:
        native = rig.data.bones[bone['name']]
        local_rest.append(native.parent.matrix_local.inverted() @ native.matrix_local if native.parent else rig.matrix_world @ native.matrix_local)
    samples = []
    for frame in range(count):
        bpy.context.scene.frame_set(frame)
        current_object = [v for row in rig.matrix_world for v in row]
        if any(abs(a - b) > 32 * 2 ** -23 * max(1, abs(a), abs(b)) for a, b in zip(current_object, metadata['fbxBind']['object'])):
            raise ValueError('Animate bones in Pose Mode; object-level armature animation is unsupported.')
        poses = []
        for i, bone in enumerate(bones):
            local = local_rest[i] @ rig.pose.bones[bone['name']].matrix_basis @ corrections[i]
            local = corrections[bone['parent']].inverted() @ local if bone['parent'] >= 0 else inverse @ local
            position, rotation, scale = local.decompose()
            poses.append({'translation': list(position), 'rotation': [rotation.x, rotation.y, rotation.z, rotation.w], 'scale': list(scale)})
        samples.append(poses)
    return samples


def write_fbx(file):
    bpy.ops.export_scene.fbx(filepath=str(file), use_selection=True, object_types={'ARMATURE', 'MESH'},
        use_custom_props=True, add_leaf_bones=False, bake_anim=True, bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
        bake_anim_step=1.0, bake_anim_simplify_factor=0.0, mesh_smooth_type='FACE', path_mode='COPY', embed_textures=True)


def export_animation(job, root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = round(job['metadata']['fps'])
    bpy.context.scene.render.fps_base = bpy.context.scene.render.fps / job['metadata']['fps']
    bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'))
    rig = armature()
    metadata = job['metadata']
    count = metadata['end'] - metadata['start'] + 1
    scene = bpy.context.scene
    scene.render.fps = round(metadata['fps'])
    scene.render.fps_base = scene.render.fps / metadata['fps']
    scene.frame_start = 0
    scene.frame_end = count - 1
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in scene.objects:
        if obj.type == 'MESH' and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'source.blend'))
    write_fbx(root / 'baseline.fbx')
    measured = import_fbx(root / 'baseline.fbx')
    metadata['fbxBind'] = bind_signature(measured, metadata)
    baseline = sample(measured, metadata)
    # Export the identical source scene with measured decoder provenance. This keeps no-op channels byte-exact.
    bpy.ops.wm.open_mainfile(filepath=str(root / 'source.blend'), load_ui=False)
    armature()[PROPERTY] = json.dumps({'metadata': metadata, 'baseline': baseline}, separators=(',', ':'))
    write_fbx(root / 'result.fbx')
    return {'frames': count, 'start': metadata['start'], 'end': metadata['end']}


def import_animation(job, root):
    rig = import_fbx(job['input'])
    stored = rig.get(PROPERTY)
    if not stored:
        raise ValueError('Choose an FBX exported by Silent Hill 3 Tools; preserve armature Custom Properties when exporting edits.')
    exchange = json.loads(stored)
    metadata = exchange['metadata']
    if metadata.get('version') != 1 or metadata.get('skeletonHash') != job['skeletonHash']:
        raise ValueError('FBX belongs to another skeleton.')
    scene = bpy.context.scene
    scene.render.fps = round(metadata['fps'])
    scene.render.fps_base = scene.render.fps / metadata['fps']
    check_bind(rig, metadata)
    exchange['samples'] = sample(rig, metadata)
    (root / 'result.json').write_text(json.dumps(exchange, separators=(',', ':')), encoding='utf-8')
    return {'frames': len(exchange['samples']), 'start': metadata['start'], 'end': metadata['end']}


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        report = export_animation(job, root) if job['mode'] == 'export' else import_animation(job, root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
