"""Run with Blender --background --factory-startup --python this_file.py."""
import sys
import tempfile
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation_exchange import write_fbx, import_scene
from animation_rig import frame_range
from io_scene_fbx import import_fbx


def verify(fps, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.object.armature_add()
    rig = bpy.context.object
    bone = rig.pose.bones[0]
    bone_name = bone.name
    for frame, value in [(0, 0), (9, 9)]:
        bone.location.x = value
        bone.keyframe_insert('location', frame=frame)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = 9
    scene.render.fps = round(fps)
    scene.render.fps_base = scene.render.fps / fps
    expected = []
    for frame in range(10):
        scene.frame_set(frame)
        expected.append(bone.matrix.translation.copy())
    write_fbx(output)
    reader = import_fbx.blen_read_animations_action_item
    imported = import_scene(output)
    assert import_fbx.blen_read_animations_action_item is reader
    metadata = {'bones': [{'name': bone_name}], 'start': 0, 'end': 9}
    assert frame_range(imported, metadata) == (0, 9), (fps, imported.animation_data.action.frame_range[:])
    for frame, position in enumerate(expected):
        bpy.context.scene.frame_set(frame)
        actual = imported.pose.bones[0].matrix.translation
        assert (actual - position).length < 1e-5, (fps, frame, actual[:], position[:])


with tempfile.TemporaryDirectory(prefix='sh3-fbx-timebase-') as folder:
    for fps in [3.75, 7.5, 11.25, 15, 29.97, 30, 60]:
        verify(fps, Path(folder) / f'{fps}.fbx')
print('Fractional/integer FBX rates preserve ten samples and evaluated motion.')
