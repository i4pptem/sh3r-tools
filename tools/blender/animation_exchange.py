import json
import sys
import traceback
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_rig import PROPERTY, armature, bind_signature, sample
from fbx_animation import remove_scale_tracks, import_fbx_animation
from animation_morphs import prepare as prepare_morphs, sample_morphs
from authoring_rig import reorient_for_authoring, disconnect_bones, save_authoring_scene


def import_scene(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if Path(file).suffix.lower() == '.blend':
        bpy.ops.wm.open_mainfile(filepath=str(file), load_ui=False, use_scripts=False)
    else:
        import_fbx_animation(file)
    rig = armature()
    if Path(file).suffix.lower() != '.blend':
        stored = rig.get(PROPERTY)
        names = [bone['name'] for bone in json.loads(stored)['metadata']['bones']] if stored else list(rig.data.bones.keys())
        disconnect_bones(rig, names)
    return rig


def write_fbx(file):
    bpy.ops.export_scene.fbx(filepath=str(file), use_selection=True, object_types={'ARMATURE', 'MESH'},
        use_custom_props=True, add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X',
        bake_anim=True, bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True,
        bake_anim_step=1.0, bake_anim_simplify_factor=0.0, mesh_smooth_type='FACE', path_mode='COPY', embed_textures=True)
    remove_scale_tracks(file)


def export_animation(job, root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    metadata = job['metadata']
    scene = bpy.context.scene
    scene.render.fps = round(metadata['fps'])
    scene.render.fps_base = scene.render.fps / metadata['fps']
    bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'), bone_heuristic='BLENDER', guess_original_bind_pose=False)
    rig = armature()
    prepare_morphs(metadata)
    count = metadata['end'] - metadata['start'] + 1
    scene.frame_start = 0
    scene.frame_end = count - 1
    if job['outputType'] == 'blend':
        reorient_for_authoring(rig, 0, count - 1)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in scene.objects:
        if obj.type == 'MESH' and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    if job['outputType'] == 'blend':
        metadata['fbxBind'] = bind_signature(rig, metadata)
        baseline, _report = sample(rig, metadata, 0, count - 1)
        rig[PROPERTY] = json.dumps({'metadata': metadata, 'baseline': baseline, 'morphBaseline': sample_morphs(metadata, 0, count - 1)}, separators=(',', ':'))
        scene.frame_set(0)
        save_authoring_scene(root / 'result.blend', rig)
        return {'frames': count, 'start': metadata['start'], 'end': metadata['end']}
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'source.blend'))
    write_fbx(root / 'baseline.fbx')
    measured = import_scene(root / 'baseline.fbx')
    metadata['fbxBind'] = bind_signature(measured, metadata)
    baseline, _report = sample(measured, metadata, 0, count - 1)
    morph_baseline = sample_morphs(metadata, 0, count - 1)
    bpy.ops.wm.open_mainfile(filepath=str(root / 'source.blend'), load_ui=False, use_scripts=False)
    armature()[PROPERTY] = json.dumps({'metadata': metadata, 'baseline': baseline, 'morphBaseline': morph_baseline}, separators=(',', ':'))
    write_fbx(root / 'result.fbx')
    return {'frames': count, 'start': metadata['start'], 'end': metadata['end']}


def import_animation(job, root):
    rig = import_scene(job['input'])
    stored = rig.get(PROPERTY)
    if not stored:
        raise ValueError('Choose an animation exported by Silent Hill 3 Tools. Preserve armature Custom Properties when exporting FBX; a saved Blender scene is also accepted.')
    exchange = json.loads(stored)
    metadata = exchange['metadata']
    if metadata.get('version') != 1 or metadata.get('skeletonHash') != job['skeletonHash']:
        raise ValueError('Animation uses another rest skeleton. Select an animation for the original model; additional control bones are allowed.')
    samples, report = sample(rig, metadata)
    try:
        morph_samples = sample_morphs(metadata, report['sourceStart'], report['sourceEnd'])
        morph_error = None
    except ValueError as error:
        morph_samples, morph_error = None, str(error)
    report.update(hasMorphs=bool(metadata.get('morph')), morphError=morph_error)
    exchange.update(samples=samples, morphSamples=morph_samples, sampleStart=report['sourceStart'], sampleEnd=report['sourceEnd'], importReport=report)
    (root / 'result.json').write_text(json.dumps(exchange, separators=(',', ':')), encoding='utf-8')
    return {'frames': len(samples), **report}


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        report = export_animation(job, root) if job['mode'] == 'export' else import_animation(job, root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error) or type(error).__name__, 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
