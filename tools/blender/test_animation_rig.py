"""Run with Blender --background --factory-startup --python this_file.py."""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_rig import TO_BLENDER, bind_signature, check_bind, sample


def flat_columns(value):
    return [value[row][column] for column in range(4) for row in range(4)]


def difference(a, b):
    return max(abs(x-y) for first, second in zip(a, b) for p, q in zip(first, second)
               for field in ['translation', 'rotation'] for x, y in zip(p[field], q[field]))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data=bpy.data.armatures.new('Original rig');rig=bpy.data.objects.new('Game rig',data)
    bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    first=data.edit_bones.new('bone000');first.head=(0,0,0);first.tail=(0,1,0)
    second=data.edit_bones.new('bone001');second.head=(0,1,0);second.tail=(0,2,0);second.parent=first
    helper=data.edit_bones.new('IK_control');helper.head=(2,0,0);helper.tail=(2,1,0)
    bpy.ops.object.mode_set(mode='OBJECT')
    bones=[{'name':name,'parent':parent,'world':flat_columns(TO_BLENDER.inverted() @ data.bones[name].matrix_local)} for name,parent in [('bone000',-1),('bone001',0)]]
    metadata={'bones':bones,'start':0,'end':9};metadata['fbxBind']=bind_signature(rig,metadata)
    original,report=sample(rig,metadata,0,9)
    assert report['ignoredBones']==['IK_control']
    rig.scale=(7,7,7);rig.location=(20,30,40)
    scaled,_=sample(rig,metadata,0,9);assert difference(original,scaled)<1e-6
    rig.location=(0,0,0);rig.scale=(2,2,2)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    applied,_=sample(rig,metadata,0,9);assert difference(original,applied)<1e-6
    rig.scale=(.5,.5,.5);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bpy.ops.object.empty_add(location=(.2,1.8,0));target=bpy.context.object
    for frame,point in [(1,(.2,1.8,0)),(10,(1.2,1.1,.3))]:
        target.location=point;target.keyframe_insert('location',frame=frame)
    constraint=rig.pose.bones['bone001'].constraints.new('IK');constraint.target=target;constraint.chain_count=2;constraint.use_stretch=False
    posed,report=sample(rig,metadata)
    assert report['sourceStart']==1 and report['sourceEnd']==10 and len(posed)==10
    assert difference(posed,original)>.05
    assert difference(posed[:1],posed[-1:])>.05
    constraint.mute=True
    direct,_=sample(rig,metadata,1,10);assert difference(direct,original)<1e-6
    bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');data.edit_bones['bone001'].roll+=.3;bpy.ops.object.mode_set(mode='OBJECT')
    try:
        check_bind(rig,metadata)
    except ValueError as error:
        assert 'bone001' in str(error) and 'rest-pose' in str(error)
    else:
        raise AssertionError('Rest-pose axes edit was accepted')
    print(json.dumps({'evaluatedIK':True,'sparseKeyInterpolation':True,'extraBonesIgnored':True,'uniformObjectScaleIgnored':True,'appliedUniformScaleNormalized':True,'sourceRange':[1,10],'restEditRejected':True}))


if __name__=='__main__':
    main()
