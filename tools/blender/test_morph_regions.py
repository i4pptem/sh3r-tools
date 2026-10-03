import bpy
import importlib.util
from pathlib import Path
from mathutils import Vector

spec=importlib.util.spec_from_file_location('sh3_morph_transfer',Path(__file__).with_name('sh3_morph_transfer.py'))
addon=importlib.util.module_from_spec(spec);spec.loader.exec_module(addon);addon.register()
bpy.ops.wm.read_factory_settings(use_empty=True)

def mesh(name,points,edges=()):
    data=bpy.data.meshes.new(name);data.from_pydata(points,edges,[(0,1,2),(3,4,5)])
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);return obj

def group(obj,name,ids):
    obj.vertex_groups.new(name=name).add(ids,1,'REPLACE')

source=mesh('Source',[(0,0,0),(2,0,0),(0,2,0),(0,0,.04),(2,0,.04),(0,2,.04)])
source.shape_key_add(name='Basis');key=source.shape_key_add(name='Morph 00')
for i,point in enumerate(key.data):point.co.z+=-1 if i<3 else 1
key.value=.7
target=mesh('Replacement',[(0,0,.01),(2,0,.01),(0,2,.01),(0,0,.03),(2,0,.03),(0,2,.03)],[(0,3)])
group(source,'Upper',[3,4,5]);group(source,'Lower',[0,1,2])
group(target,'Upper',[0,1,2]);group(target,'Lower',[3,4,5]);group(target,'SH3_Unmapped',[2])
regions=[('Upper','Upper','Upper'),('Lower','Lower','Lower')]
before=[tuple(v.co) for v in target.data.vertices]
nearest,_=addon.transfer(source,target,max_distance=1,smooth_iterations=0)
assert nearest.data.shape_keys.key_blocks['Morph 00'].data[0].co.z<0
anchors=[Vector((0,0,0)),Vector((2,0,0)),Vector((0,2,.04))]
for landmarks in (None,(anchors,anchors)):
    result,unmatched=addon.transfer(source,target,max_distance=1,regions=regions,landmarks=landmarks,smooth_iterations=3)
    assert unmatched==0 and result.vertex_groups.get('SH3_Unmapped') is None
    assert [tuple(v.co) for v in result.data.shape_keys.reference_key.data]==before
    for i,p in enumerate(result.data.shape_keys.key_blocks['Morph 00'].data):
        expected=target.data.vertices[i].co.z+(1 if i<3 else -1)
        assert abs(p.co.z-expected)<1e-6,(i,p.co.z,expected)
assert target.data.shape_keys is None and abs(key.value-.7)<1e-6
count=len(bpy.data.objects)
for invalid,text in [(regions+[('Duplicate','Upper','Upper')],'both Upper and Duplicate'),([('Missing','','Upper')],'choose both'),([('Unknown','no-such-group','Upper')],'Missing vertex group')]:
    try:addon.transfer(source,target,max_distance=1,regions=invalid)
    except ValueError as error:assert text in str(error),str(error)
    else:raise AssertionError('Invalid region accepted')
assert len(bpy.data.objects)==count
print('MORPH REGIONS PASS: opposite close surfaces, protected smoothing, both matching modes, stale diagnostics, invalid groups, source and Basis preservation',flush=True)
