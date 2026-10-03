import bpy
import importlib.util
import json
from pathlib import Path
from mathutils import Vector, Matrix

spec=importlib.util.spec_from_file_location('sh3_morph_transfer',Path(__file__).with_name('sh3_morph_transfer.py'))
addon=importlib.util.module_from_spec(spec);spec.loader.exec_module(addon);addon.register()
bpy.ops.wm.read_factory_settings(use_empty=True)
def mesh(name,points,faces):
    data=bpy.data.meshes.new(name);data.from_pydata(points,[],faces);obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);return obj
source=mesh('Original',[(0,0,0),(2,0,0),(0,2,0)],[(0,1,2)])
source.shape_key_add(name='Basis');key=source.shape_key_add(name='Morph 00');
for point in key.data:point.co.z=2
key.value=.8
target=mesh('Replacement',[(.2,.2,0),(.4,.2,0),(.2,.4,0),(30,30,0)],[(0,1,2)])
result,missing=addon.transfer(source,target,max_distance=1)
assert missing==1
assert all(abs(result.data.shape_keys.key_blocks['Morph 00'].data[i].co.z-2)<1e-6 for i in range(3))
assert result.data.shape_keys.key_blocks['Morph 00'].data[3].co.z==0
assert abs(key.value-.8)<1e-6 and target.data.shape_keys is None
assert result.vertex_groups.get('SH3_Unmapped')
source.matrix_world=Matrix.Translation((5,6,7))@Matrix.Diagonal((2,2,2,1))
target.matrix_world=source.matrix_world.copy()
scaled,missing=addon.transfer(source,target,max_distance=1)
assert all(abs(scaled.data.shape_keys.key_blocks['Morph 00'].data[i].co.z-2)<1e-6 for i in range(3))
mask=scaled.vertex_groups.new(name='Region');mask.add([0],1,'REPLACE')
preserved=scaled.data.shape_keys.key_blocks['Morph 00'].data[1].co.copy()
regional,_=addon.transfer(source,scaled,target_group='Region',max_distance=1,strength=.5)
assert abs(regional.data.shape_keys.key_blocks['Morph 00'].data[0].co.z-1)<1e-6
assert (regional.data.shape_keys.key_blocks['Morph 00'].data[1].co-preserved).length<1e-6
print('MORPH ADDON: analytic displacement, scaling, masking, unmatched points and source preservation passed',flush=True)


spike=mesh('Smoothing',[(0,0,0),(1,0,0),(2,0,0)],[])
spike.data.clear_geometry();spike.data.from_pydata([(0,0,0),(1,0,0),(2,0,0)],[(0,1),(1,2)],[])
spike.shape_key_add(name='Basis');shape=spike.shape_key_add(name='Spike');shape.data[1].co.z=2
base=[tuple(p.co) for p in spike.data.shape_keys.reference_key.data]
addon.smooth_keys(spike,1,.25)
assert [round(p.co.z,4) for p in shape.data]==[.5,1.5,.5]
assert base==[tuple(p.co) for p in spike.data.shape_keys.reference_key.data]
mask=spike.vertex_groups.new(name='Protected');mask.add([1],1,'REPLACE')
before=[tuple(p.co) for p in shape.data];addon.smooth_keys(spike,4,.5,'Protected')
assert before==[tuple(p.co) for p in shape.data]
print('MORPH SMOOTHING: controlled diffusion, Basis and isolated mask preservation passed')
