"""Run with Blender --background --factory-startup --python this_file.py."""
import copy
import sys
import tempfile
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_exchange import export_animation, import_scene
from model_export import export_model
from animation_rig import TO_BLENDER, bind_signature, matrix, sample


def columns(value):
    return [value[row][col] for col in range(4) for row in range(4)]


def points():
    graph = bpy.context.evaluated_depsgraph_get()
    obj = next(obj for obj in bpy.context.scene.objects if obj.type == 'MESH').evaluated_get(graph)
    mesh = obj.to_mesh()
    result = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    obj.to_mesh_clear()
    return result


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data = bpy.data.armatures.new('Skeleton'); rig = bpy.data.objects.new('SH3 rig', data)
    bpy.context.collection.objects.link(rig); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    root = data.edit_bones.new('bone000'); root.head = (0,0,0); root.tail = (1,0,0); root.roll = .3
    child = data.edit_bones.new('bone001'); child.head = (0,1,0); child.tail = (.2,2,.4); child.parent = root
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh = bpy.data.meshes.new('Triangle'); mesh.from_pydata([(0,0,0),(.2,1,0),(.4,2,.2)], [], [(0,1,2)])
    obj = bpy.data.objects.new('Skin', mesh); bpy.context.collection.objects.link(obj); obj.select_set(True)
    obj.vertex_groups.new(name='bone000').add([0,1], 1, 'REPLACE')
    obj.vertex_groups.new(name='bone001').add([2], 1, 'REPLACE')
    obj.modifiers.new('Skin', 'ARMATURE').object = rig
    bones = [{'name': b.name, 'parent': i-1, 'world': columns(TO_BLENDER.inverted() @ b.matrix_local)} for i,b in enumerate(data.bones)]
    metadata = {'bones':bones, 'start':0, 'end':3, 'fps':30, 'fbxBind':bind_signature(rig, {'bones':bones})}
    for frame, angle in [(0,0), (3,.8)]:
        for i, bone in enumerate(rig.pose.bones):
            bone.rotation_mode = 'XYZ'; bone.rotation_euler = (.2*angle, angle, -.3*angle)
            bone.location = (angle * .1, 0, 0); bone.keyframe_insert('rotation_euler', frame=frame); bone.keyframe_insert('location', frame=frame)
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 0; bpy.context.scene.frame_end = 3
    before, _ = sample(rig, metadata, 0, 3)
    vertices = []
    for frame in range(4):
        bpy.context.scene.frame_set(frame); bpy.context.view_layer.update(); vertices.append(points())
    with tempfile.TemporaryDirectory(prefix='sh3-export-axes-') as folder:
        root = Path(folder)
        bpy.ops.export_scene.gltf(filepath=str(root / 'model.glb'), export_format='GLB', use_selection=True)
        check_export_formats(root, bones, metadata, before, vertices)
    print('Native FBX and joint-aligned Blender model/animation exports verified.')


def check_export_formats(root, bones, metadata, samples, vertices):
    for output_type in ('fbx', 'blend'):
        for mode in ('model', 'animation'):
            if mode == 'animation':
                export_animation({'metadata': copy.deepcopy(metadata), 'outputType': output_type}, root)
            else:
                report = export_model(root, bones, output_type)
                assert report['meshes'] == 1, report
                assert report['vertices'] == 3, report
            rig = import_scene(root / ('result.' + output_type))
            meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
            assert len(meshes) == 1, [obj.name for obj in meshes]
            if output_type == 'fbx':
                for bone in bones:
                    expected = TO_BLENDER @ matrix(bone['world'])
                    actual = rig.matrix_world @ rig.data.bones[bone['name']].matrix_local
                    assert max(abs(a-b) for r,s in zip(actual, expected) for a,b in zip(r,s)) < 1e-5, (mode, bone['name'])
            else:
                data = rig.data
                assert (data.bones['bone000'].tail_local - data.bones['bone001'].head_local).length < 1e-6
                assert not any(bone.use_connect for bone in data.bones)
            if mode == 'animation':
                calibrated = copy.deepcopy(metadata)
                calibrated['fbxBind'] = bind_signature(rig, metadata)
                after, _ = sample(rig, calibrated, 0, 3)
                for first, second in zip(samples, after):
                    for a,b in zip(first,second):
                        assert max(abs(x-y) for x,y in zip(a['translation'],b['translation'])) < 1e-5, (output_type, a, b)
                        assert 1-abs(sum(x*y for x,y in zip(a['rotation'],b['rotation']))) < 1e-6
                for frame, expected in enumerate(vertices):
                    bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
                    assert max((a-b).length for a,b in zip(points(), expected)) < 1e-5, (output_type, frame)


if __name__ == '__main__':
    main()
