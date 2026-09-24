"""Export the canonical model exchange scene as a textured, skinned FBX."""
import json
import sys
import traceback
from pathlib import Path

import bpy


def export_model(root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'), merge_vertices=False)
    helpers = {bone.custom_shape for obj in bpy.context.scene.objects if obj.type == 'ARMATURE' for bone in obj.pose.bones if bone.custom_shape}
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj not in helpers]
    if not meshes:
        raise ValueError('The model has no meshes to export.')
    # Embedded FBX media needs actual files even when glTF images are packed.
    for index, image in enumerate(bpy.data.images):
        if image.type == 'IMAGE' and image.size[0]:
            image.filepath_raw = str(root / f'texture_{index:03d}.png')
            image.file_format = 'PNG'
            image.save()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj not in helpers and obj.type in {'MESH', 'ARMATURE', 'EMPTY'}:
            obj.select_set(True)
    print('SH3_PROGRESS Exporting meshes, skeleton and shape keys…', flush=True)
    bpy.ops.export_scene.fbx(
        filepath=str(root / 'result.fbx'), use_selection=True,
        object_types={'ARMATURE', 'MESH', 'EMPTY'}, use_custom_props=True,
        add_leaf_bones=False, use_armature_deform_only=False,
        use_mesh_modifiers=False, bake_anim=False, mesh_smooth_type='OFF',
        axis_forward='-Z', axis_up='Y', path_mode='COPY', embed_textures=True)
    return {
        'meshes': len(meshes),
        'vertices': sum(len(obj.data.vertices) for obj in meshes),
        'bones': sum(len(obj.data.bones) for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'),
        'shapeKeys': sum(len(obj.data.shape_keys.key_blocks) - 1 for obj in meshes if obj.data.shape_keys),
    }


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        if job['mode'] != 'export':
            raise ValueError('Model FBX exchange supports export only.')
        report = export_model(root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
