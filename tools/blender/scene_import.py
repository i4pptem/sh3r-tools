"""Sample an exported cutscene without executing embedded scripts or editing its file."""
import json
import sys
import traceback
from pathlib import Path
import bpy
from mathutils import Matrix, Quaternion, Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_rig import PROPERTY, sample, TO_BLENDER, row_matrix
from animation_morphs import sample_morphs
from scene_channels import TRACK, sample_channel


def actor_samples(rig, exchange, scene_world):
    metadata = exchange['metadata']
    count = metadata['end'] - metadata['start'] + 1
    samples, report = sample(rig, metadata, 0, count - 1)
    expected = row_matrix(metadata['fbxBind']['object'])
    basis = row_matrix(scene_world)
    for frame, poses in enumerate(samples):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        world = rig.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world
        delta = TO_BLENDER.inverted() @ expected @ basis.inverted() @ world @ expected.inverted() @ TO_BLENDER
        if any(abs(value - 1) > 1e-5 for value in delta.to_scale()):
            raise ValueError(rig.name + ': cutscene object scale changed. Animate the original bones or move/rotate the character placement.')
        for i, bone in enumerate(metadata['bones']):
            if bone['parent'] >= 0:
                continue
            pose = poses[i]
            x, y, z, w = pose['rotation']
            local = delta @ Matrix.LocRotScale(Vector(pose['translation']), Quaternion((w, x, y, z)), Vector((1, 1, 1)))
            position, rotation, _ = local.decompose()
            pose['translation'] = list(position)
            pose['rotation'] = [rotation.x, rotation.y, rotation.z, rotation.w]
    try:
        morphs, morph_error = sample_morphs(metadata, 0, count - 1), None
    except ValueError as error:
        morphs, morph_error = None, str(error)
    exchange.update(samples=samples, sampleStart=0, sampleEnd=count - 1,
                    morphSamples=morphs, morphError=morph_error, importReport=report)
    return exchange


def import_scene(job, root):
    bpy.ops.wm.open_mainfile(filepath=job['input'], load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    stored = scene.get('sh3_cutscene')
    if not stored:
        raise ValueError('Choose a complete cutscene .blend exported from Cutscene Inspector.')
    metadata = json.loads(stored)
    if metadata.get('version') != 2:
        raise ValueError('Export this cutscene again with the current SH3 Tools version; this older file has no scene import metadata.')
    if scene.frame_start != 0 or scene.frame_end != metadata['end'] - metadata['start']:
        raise ValueError('Keep the exported scene frame range. Cutscene duration changes are not supported.')
    if abs(scene.render.fps / scene.render.fps_base - 30) > 1e-6:
        raise ValueError('Keep the exported 30 FPS cutscene timeline.')
    actors = []
    for info in metadata['actors']:
        rigs = [obj for obj in scene.objects if obj.type == 'ARMATURE' and obj.get('sh3_model_id') == info['modelId'] and PROPERTY in obj]
        if len(rigs) != 1:
            raise ValueError(f"Character {info['modelId']}: keep one original armature and its SH3 custom properties.")
        rig = rigs[0]
        print('SH3_PROGRESS Sampling ' + rig.name, flush=True)
        actors.append({'modelId': info['modelId'], 'exchange': actor_samples(rig, json.loads(rig[PROPERTY]), json.loads(rig['sh3_scene_world']))})
    channels = []
    for obj in scene.objects:
        if TRACK not in obj:
            continue
        track = json.loads(obj[TRACK])
        print('SH3_PROGRESS Sampling ' + obj.name, flush=True)
        track['samples'] = sample_channel(obj, track)
        channels.append(track)
    if sorted(item['id'] for item in channels) != sorted(metadata['channels']):
        raise ValueError('A scene controller is missing or duplicated. Keep exported cameras, lights and prop controllers with their SH3 properties.')
    (root / 'result.json').write_text(json.dumps({'metadata': metadata, 'actors': actors, 'channels': channels}, separators=(',', ':')), encoding='utf-8')
    return {'notes': ['Imports existing character/morph tracks, camera, lights and prop controllers. Geometry, textures, audio, visibility, particles and stage scripts keep their current game assets.',
                      'Light energy/attenuation is an approximation in Blender; native light category and channel counts are preserved. Channels ending before the exported range are held for reference and are not imported.']}


if __name__ == '__main__':
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        report = import_scene(job, root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')
