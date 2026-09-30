"""Convert a Blender or FBX scene to the canonical skinned model exchange representation."""
import json
import sys
import traceback
from pathlib import Path

import bpy


def import_model(source, root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print('SH3_PROGRESS Reading model meshes, rig and materials…', flush=True)
    if source.suffix.lower() == '.blend':
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    else:
        bpy.ops.import_scene.fbx(
            filepath=str(source), use_anim=False, use_custom_props=True,
            use_image_search=False, use_custom_normals=True, ignore_leaf_bones=False,
            automatic_bone_orientation=False, use_prepost_rot=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        raise ValueError('The scene contains no meshes.')
    for image in bpy.data.images:
        if image.type == 'IMAGE' and not len(image.pixels):
            raise ValueError(f'Missing model texture: {image.filepath or image.name}. Embed it or keep the linked image at its saved path.')
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            obj.data.pose_position = 'REST'
        if obj.type == 'MESH' and obj.data.shape_keys:
            for key in obj.data.shape_keys.key_blocks:
                key.value = 0.0
    print('SH3_PROGRESS Preparing model and embedded PNG textures…', flush=True)
    bpy.ops.export_scene.gltf(
        filepath=str(root / 'result.glb'), export_format='GLB',
        export_image_format='AUTO', export_materials='EXPORT',
        export_skins=True, export_all_influences=True,
        export_morph=True, export_morph_normal=True,
        export_animations=False, export_extras=True,
        export_yup=True, export_apply=False, export_def_bones=False)
    return {'meshes': len(meshes), 'images': len(bpy.data.images)}


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        if job['mode'] != 'import':
            raise ValueError('Unknown model import operation.')
        report = import_model(Path(job['input']), root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
