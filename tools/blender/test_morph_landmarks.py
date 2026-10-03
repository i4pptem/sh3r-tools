import bpy
import importlib.util
from pathlib import Path
from mathutils import Vector
spec=importlib.util.spec_from_file_location('sh3_morph_transfer',Path(__file__).with_name('sh3_morph_transfer.py'))
addon=importlib.util.module_from_spec(spec);spec.loader.exec_module(addon);addon.register()
bpy.ops.wm.read_factory_settings(use_empty=True)
def mesh(name,points):
    data=bpy.data.meshes.new(name);data.from_pydata(points,[],[(0,1,2)]);obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);return obj
a=[(0,0,0),(2,0,0),(0,2,0)]
b=[(5,6,7),(5,10,7),(1,6,7)]
warp=addon.LandmarkWarp(a,b)
for actual,expected in zip(warp.vectors(a),b):assert (actual-Vector(expected)).length<1e-6
source=mesh('Original_Cloak',a);source.shape_key_add(name='Basis');key=source.shape_key_add(name='Cloak_03')
for p in key.data:p.co.z=1
target=mesh('Replacement_Cloak',b)
result,missing=addon.transfer(source,target,max_distance=.1,smooth_iterations=0,landmarks=(a,b))
assert missing==0 and target.data.shape_keys is None
for original,basis,morphed in zip(b,result.data.shape_keys.reference_key.data,result.data.shape_keys.key_blocks['Cloak_03'].data):
    assert (basis.co-Vector(original)).length<1e-6
    assert abs(morphed.co.z-basis.co.z-2)<1e-5
assert result.data.shape_keys.key_blocks['Cloak_03'].name=='Cloak_03'
# Non-affine anchors must interpolate exactly without editing the target Basis.
aa=[(0,0,0),(2,0,0),(0,2,0),(0,0,2),(1,1,1)];bb=[(0,0,0),(2,0,0),(0,2,0),(0,0,2),(1,1.4,1)]
warp=addon.LandmarkWarp(aa,bb)
assert all((x-Vector(y)).length<1e-6 for x,y in zip(warp.vectors(aa),bb))
for points in [[(0,0,0)]*3,[(0,0,0),(1,0,0),(2,0,0)]]:
    try:addon.LandmarkWarp(points,points)
    except ValueError:pass
    else:raise AssertionError('Degenerate landmarks accepted')
settings=bpy.context.scene.sh3_morph_transfer
settings.source=source;settings.target=target;settings.match_mode='LANDMARKS'
for i in range(3):pair=settings.landmarks.add();pair.source_vertex=pair.target_vertex=i
assert len(addon.paired_landmarks(settings)[0])==3
settings.landmarks[0].target_vertex=-1
try:addon.paired_landmarks(settings)
except ValueError:pass
else:raise AssertionError('Uncaptured landmark accepted')
print('LANDMARKS PASS: similarity motion, non-affine anchors, non-facial keys, Basis preservation, degeneracy and incomplete pairs')
