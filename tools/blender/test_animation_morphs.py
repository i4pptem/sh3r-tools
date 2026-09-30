"""Self-contained Blender checks for cutscene facial exchange; no game data."""
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_morphs import prepare, sample_morphs
from animation_rig import frame_range

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.pose.bones[0].keyframe_insert('location', frame=0)
rig.pose.bones[0].keyframe_insert('location', frame=2)
metadata = {'start': 0, 'end': 2, 'bones': [{'name': rig.data.bones[0].name}],
            'morph': {'names': ['Smile'], 'bindings': [{'name': 'Face', 'targets': [0]}, {'name': 'Teeth', 'targets': [0]}]}}
objects = []
for name in ['Face', 'Teeth']:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
    obj = bpy.data.objects.new(name + '.001', mesh)
    bpy.context.collection.objects.link(obj)
    obj.shape_key_add(name='Basis')
    key = obj.shape_key_add(name='Smile')
    key.data[0].co.z = 1
    key.slider_min = -8
    key.slider_max = 8
    for frame, value in [(0, -.5), (5, .75)]:
        key.value = value
        key.keyframe_insert('value', frame=frame)
    objects.append(obj)
prepare(metadata)
assert frame_range(rig, metadata) == (0, 5), 'Facial-only keys must extend the sampled range.'
values = sample_morphs(metadata, 0, 5)
assert abs(values[0][0] + .5) < 1e-6 and abs(values[-1][0] - .75) < 1e-6
objects[0].name = 'Renamed face'
assert sample_morphs(metadata, 0, 0)[0] == [-.5], 'The stored native mesh identity must survive object renaming.'
key = objects[1].data.shape_keys.key_blocks['Smile']
key.value = .1
key.keyframe_insert('value', frame=0)
try:
    sample_morphs(metadata, 0, 0)
except ValueError as error:
    assert 'conflicting weights' in str(error)
else:
    raise AssertionError('Conflicting weights on a shared native target were accepted.')
bpy.data.objects.remove(objects[1], do_unlink=True)
try:
    sample_morphs(metadata, 0, 0)
except ValueError as error:
    assert 'Missing morph mesh' in str(error)
else:
    raise AssertionError('Missing morph mesh was accepted.')
print('Cutscene facial Blender checks passed.')
