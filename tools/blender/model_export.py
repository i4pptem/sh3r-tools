"""Export the canonical model as a calibrated Blender or FBX authoring scene."""
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix
sys.path.insert(0, str(Path(__file__).resolve().parent))
from authoring_rig import reorient_for_authoring, save_authoring_scene


def model_bind_metadata(rig, bones):
    to_blender = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    corrections = {}
    for bone in bones:
        native = Matrix([bone['world'][i:i + 4] for i in range(0, 16, 4)]).transposed()
        exported = to_blender.inverted() @ rig.matrix_world @ rig.data.bones[bone['name']].matrix_local
        correction = exported.inverted() @ native
        corrections[bone['name']] = [correction[row][col] for col in range(4) for row in range(4)]
    return json.dumps({'version': 1, 'corrections': corrections}, separators=(',', ':'))


def export_model(root, bones, output_type):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'), merge_vertices=False,
                              bone_heuristic='BLENDER', guess_original_bind_pose=False)
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    if output_type == 'blend':
        for rig in rigs:
            reorient_for_authoring(rig)
    helpers = {bone.custom_shape for rig in rigs for bone in rig.pose.bones if bone.custom_shape}
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
    if output_type == 'blend':
        rig = next((obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'), None)
        if rig:
            rig['sh3_model_bind'] = model_bind_metadata(rig, bones)
            save_authoring_scene(root / 'result.blend', rig)
        else:
            bpy.ops.file.pack_all()
            bpy.ops.wm.save_as_mainfile(filepath=str(root / 'result.blend'))
    elif bones:
        bpy.ops.wm.save_as_mainfile(filepath=str(root / 'source.blend'))
        write_fbx(root / 'baseline.fbx')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(root / 'baseline.fbx'), use_anim=False,
                                automatic_bone_orientation=False, ignore_leaf_bones=False)
        rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
        if len(rigs) != 1:
            raise ValueError('Expected the original model armature in the exported FBX.')
        bind = model_bind_metadata(rigs[0], bones)
        bpy.ops.wm.open_mainfile(filepath=str(root / 'source.blend'), load_ui=False, use_scripts=False)
        for obj in bpy.context.scene.objects:
            if obj.type == 'ARMATURE':
                obj['sh3_model_bind'] = bind
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.select_get()]
    if output_type == 'fbx':
        write_fbx(root / 'result.fbx')
    return {
        'meshes': len(meshes),
        'vertices': sum(len(obj.data.vertices) for obj in meshes),
        'bones': sum(len(obj.data.bones) for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'),
        'shapeKeys': sum(len(obj.data.shape_keys.key_blocks) - 1 for obj in meshes if obj.data.shape_keys),
    }


def write_fbx(file):
    bpy.ops.export_scene.fbx(
        filepath=str(file), use_selection=True,
        object_types={'ARMATURE', 'MESH', 'EMPTY'}, use_custom_props=True,
        add_leaf_bones=False, use_armature_deform_only=False,
        primary_bone_axis='Y', secondary_bone_axis='X',
        use_mesh_modifiers=False, bake_anim=False, mesh_smooth_type='OFF',
        axis_forward='-Z', axis_up='Y', path_mode='COPY', embed_textures=True)


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        if job['mode'] != 'export':
            raise ValueError('Model scene exchange supports export only.')
        report = export_model(root, job['bones'], job['outputType'])
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
