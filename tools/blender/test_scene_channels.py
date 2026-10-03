"""Run with Blender --background --factory-startup --python tools/blender/test_scene_channels.py."""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from scene_channels import light_channel, mark_channel, sample_channel
from scene_export import camera

bpy.ops.wm.read_factory_settings(use_empty=True)
for kind,category,values in [(5,2,[9,8,7,1.5,.4,.2,2,-3,4]),(6,11,[3,2,1,.2,.3,.4,1.2,40]),(7,14,[3,2,1,.2,.3,.4,1.2,40,7,5,9,20,10])]:
    track={'id':f'{kind}:{category}:0','type':kind,'modelId':category,'index':0,'native':[values]}
    obj=light_channel(track);mark_channel(obj,track)
    read=sample_channel(obj,track)[0]
    for a,b in zip(values,read):
        assert abs(a-b)<2e-5*max(1,abs(a)),(kind,values,read)
    if kind==5:
        assert read[:3]==values[:3]
        assert abs(Vector(read[6:9]).length-Vector(values[6:9]).length)<1e-5
    old=read[3:6]
    obj.data.energy*=2;obj.data.keyframe_insert('energy',frame=0)
    read=sample_channel(obj,track)[0]
    assert all(abs(a*2-b)<1e-5 for a,b in zip(old,read[3:6]))
    if kind!=5:
        obj.location.x+=100;obj.keyframe_insert('location',frame=0)
        assert abs(sample_channel(obj,track)[0][0]-(values[0]-2))<1e-5

values=[10,20,30,15,22,34,35,45]
half=math.atan(1.6670000553131104*math.tan(values[7]*0.01745329238474369/2))
fov=2*math.atan(224/(290.9090881347656/math.tan(half)))*180/math.pi
camera({'camera':[dict(eye=[-500,1000,-1500],target=[-750,1100,-1700],roll=math.radians(35),fov=fov)],'cuts':[False],
        'cameraTrack':dict(id='3:0:0',type=3,modelId=0,index=0,native=[values])})
import json
obj=bpy.context.scene.camera;track=json.loads(obj['sh3_scene_track']);read=sample_channel(obj,track)[0]
assert all(abs(a-b)<1e-4 for a,b in zip(values,read)),(values,read)
print('SCENE CHANNELS: sun/point/spot colors, intensity, coordinates, direction magnitude, raw attenuation, cone, camera lens and roll passed')

held = dict(id='6:11:99', type=6, modelId=11, index=99, readOnly=True,
            native=[[3,2,1,.2,.3,.4,1.2,40]])
obj = light_channel(held)
mark_channel(obj, held)
assert 'sh3_held_channel' in obj and 'sh3_scene_track' not in obj
assert 'baseline' not in held
print('Held final light pose is visible and excluded from writable scene channels')
