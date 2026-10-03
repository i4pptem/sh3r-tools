"""Assemble a portable Blender scene from sampled native cutscene tracks."""
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_rig import PROPERTY, TO_BLENDER, matrix, bind_signature, sample
from animation_morphs import prepare as prepare_morphs, sample_morphs
from authoring_rig import reorient_for_authoring
from exchange_progress import frames as progress_frames, report
from scene_channels import mark_channel, light_channel, key_property


def import_asset(root, item, prefix):
    previous = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(root / item['file']), bone_heuristic='BLENDER', guess_original_bind_pose=False)
    objects = [obj for obj in bpy.data.objects if obj not in previous]
    collection = bpy.data.collections.new(prefix + ' · ' + item['name'])
    bpy.context.scene.collection.children.link(collection)
    meshes = {}
    for obj in objects:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
        if obj.type == 'MESH' and obj.data.get('sh3_scene_mesh'):
            original = obj.data.name
            # glTF's name may acquire a Blender suffix; use the exported stable property.
            name = obj.data.get('sh3_scene_mesh', original)
            meshes[name] = obj
        obj.name = prefix + ' · ' + obj.name
    return objects, meshes, collection


def curves(owner):
    animation = owner.animation_data
    if not animation or not animation.action:
        return []
    action = animation.action
    if hasattr(action, 'layers'):
        return [curve for layer in action.layers for strip in layer.strips
                for bag in strip.channelbags for curve in bag.fcurves]
    return list(action.fcurves)


def interpolation(owner, cuts):
    for curve in curves(owner):
        for point in curve.keyframe_points:
            index = int(round(point.co.x))
            point.interpolation = 'CONSTANT' if 0 <= index < len(cuts) and cuts[index] else 'LINEAR'


def character(root, item, index, cuts):
    prefix = f"Character {index} ({item['modelId']:04x})"
    objects, meshes, collection = import_asset(root, item, prefix)
    rigs = [obj for obj in objects if obj.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError(f'{prefix}: expected one original armature.')
    rig = rigs[0]
    metadata = item['metadata']
    for name, obj in meshes.items():
        obj.data.name = prefix + '/' + name
    if metadata.get('morph'):
        for binding in metadata['morph']['bindings']:
            binding['name'] = prefix + '/' + binding['name']
    prepare_morphs(metadata)
    count = metadata['end'] - metadata['start'] + 1
    roots = [obj.name for obj in objects if obj.parent is None]
    reorient_for_authoring(rig, 0, count - 1)
    metadata['fbxBind'] = bind_signature(rig, metadata)
    baseline, _ = sample(rig, metadata, 0, count - 1)
    rig[PROPERTY] = json.dumps({'metadata': metadata, 'baseline': baseline,
                              'morphBaseline': sample_morphs(metadata, 0, count - 1)}, separators=(',', ':'))
    rig['sh3_model_id'] = item['modelId']
    placement = bpy.data.objects.new(prefix, None)
    collection.objects.link(placement)
    ox, oy, oz = metadata['origin']
    placement.location = (-ox, -oz, -oy)
    for name in roots:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            obj.parent = placement
    for name, obj in meshes.items():
        obj.hide_render = name in item['hidden']
        obj.hide_set(name in item['hidden'])
        if obj.data.shape_keys:
            interpolation(obj.data.shape_keys, cuts)
    interpolation(rig, cuts)
    rig.show_in_front = True
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    rig['sh3_scene_world'] = json.dumps([value for row in rig.matrix_world for value in row])


def environment(root, item, index, cuts, controllers):
    _, meshes, _ = import_asset(root, item, f'Environment {index}')
    for part in item['parts']:
        obj = meshes.get(part['name'])
        if obj is None:
            raise ValueError('Missing map part: ' + part['name'])
        obj['sh3_part_id'] = part['partId']
        obj['sh3_object_type'] = part['objectType']
        if part.get('track') in controllers:
            obj.parent = controllers[part['track']]
            obj.matrix_parent_inverse = TO_BLENDER @ matrix(part['inverse']) @ TO_BLENDER.inverted()
        if part['visible']:
            previous = None
            for frame, visible in enumerate(part['visible']):
                if visible != previous:
                    obj.hide_render = obj.hide_viewport = not visible
                    obj.keyframe_insert('hide_render', frame=frame)
                    obj.keyframe_insert('hide_viewport', frame=frame)
                previous = visible


def camera(job):
    data = bpy.data.cameras.new('SH3 Cutscene Camera')
    obj = bpy.data.objects.new(data.name, data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    data.clip_start, data.clip_end = 1, 100000
    data.sensor_fit = 'VERTICAL'
    obj.rotation_mode = 'QUATERNION'
    previous = None
    for frame in progress_frames(0, len(job['camera']) - 1, 'Creating scene camera'):
        pose = job['camera'][frame]
        eye = TO_BLENDER @ Vector(pose['eye'])
        target = TO_BLENDER @ Vector(pose['target'])
        rotation = (target - eye).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), pose['roll'])
        if previous and rotation.dot(previous) < 0:
            rotation.negate()
        previous = rotation.copy()
        obj.location, obj.rotation_quaternion = eye, rotation
        key_property(obj, 'sh3_target_distance', (target - eye).length, frame, 'Native camera target distance. Rotation aims the camera; this property preserves its target.')
        data.lens = data.sensor_height / (2 * math.tan(math.radians(pose['fov']) / 2))
        obj.keyframe_insert('location', frame=frame)
        obj.keyframe_insert('rotation_quaternion', frame=frame)
        data.keyframe_insert('lens', frame=frame)
    interpolation(obj, job['cuts'])
    interpolation(data, job['cuts'])
    if job['cameraTrack']:
        mark_channel(obj, job['cameraTrack'])


def export_scene(job, root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = job['fps']
    scene.frame_start, scene.frame_end = 0, job['end'] - job['start']
    scene.render.resolution_x, scene.render.resolution_y = 1440, 1080
    for index, item in enumerate(job['actors']):
        report(f"Importing character {index + 1}/{len(job['actors'])} · {item['name']}")
        character(root, item, index, job['cuts'])
    controllers = {}
    for track in job['props']:
        obj = bpy.data.objects.new('SH3 Prop ' + track['id'], None)
        obj.empty_display_type = 'ARROWS'
        obj.empty_display_size = 50
        scene.collection.objects.link(obj)
        obj.rotation_mode = 'QUATERNION'
        previous = None
        for frame in progress_frames(0, len(track['matrices']) - 1, 'Creating moving object · ' + obj.name):
            values = track['matrices'][frame]
            obj.matrix_world = TO_BLENDER @ matrix(values) @ TO_BLENDER.inverted()
            if previous and obj.rotation_quaternion.dot(previous) < 0:
                obj.rotation_quaternion.negate()
            previous = obj.rotation_quaternion.copy()
            obj.keyframe_insert('location', frame=frame)
            obj.keyframe_insert('rotation_quaternion', frame=frame)
        interpolation(obj, job['cuts'])
        track.pop('matrices')
        if not track.get('readOnly'):
            mark_channel(obj, track)
        else:
            obj['sh3_scripted_motion'] = 'Stage-script preview; not stored in PACK'
        controllers[track['id']] = obj
    for track in job['lights']:
        obj = light_channel(track)
        interpolation(obj, job['cuts'])
        interpolation(obj.data, job['cuts'])
        mark_channel(obj, track)
    for index, item in enumerate(job['maps']):
        report(f"Importing environment {index + 1}/{len(job['maps'])} · {item['name']}")
        environment(root, item, index, job['cuts'], controllers)
    camera(job)
    if job['audio']:
        editor = scene.sequence_editor_create()
        strips = editor.strips if hasattr(editor, 'strips') else editor.sequences
        strips.new_sound('Cutscene soundtrack', str(root / job['audio']), channel=1, frame_start=-job['start'] - round(job.get('audioOffset', 0) * job['fps']))
    scene['sh3_cutscene'] = json.dumps({**job['exchange'], **{key: job[key] for key in ['name', 'issues', 'limitations']}, 'channels': [track['id'] for track in [job['cameraTrack']] + job['lights'] + job['props'] if track and not track.get('readOnly')]})
    scene.frame_set(0)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.clip_end = 100000
                area.spaces.active.shading.color_type = 'TEXTURE'
    report('Packing textures and soundtrack')
    bpy.ops.file.pack_all()
    report('Compressing and saving Blender scene')
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'result.blend'), compress=True)
    return {'characters': len(job['actors']), 'maps': len(job['maps']), 'frames': scene.frame_end + 1,
            'start': job['start'], 'end': job['end'], 'audio': bool(job['audio']), 'issues': job['issues']}


if __name__ == '__main__':
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        report = export_scene(job, root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')
