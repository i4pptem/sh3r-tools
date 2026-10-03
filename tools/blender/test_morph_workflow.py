"""Run with Blender --background --factory-startup --python-exit-code 1 --python this_file."""
import importlib.util
import json
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

spec = importlib.util.spec_from_file_location('sh3_morph_transfer', Path(__file__).with_name('sh3_morph_transfer.py'))
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.register()


def mesh(name, points, faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata(points, [], faces)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def test_preview_lifecycle():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = mesh('Original hair', [(0, 0, 0), (2, 0, 0), (0, 2, 0)], [(0, 1, 2)])
    source.shape_key_add(name='Basis')
    for name, delta in [('Hair bend', Vector((0, 0, 1))), ('Cloth flutter', Vector((1, 0, 0)))]:
        key = source.shape_key_add(name=name)
        for p in key.data:
            p.co += delta
    source.data.shape_keys.key_blocks['Hair bend'].value = .37
    source.show_only_shape_key = True
    target = mesh('Replacement hair', [(0, 0, 0), (2, 0, 0), (0, 2, 0)], [(0, 1, 2)])
    group = target.vertex_groups.new(name='bone000')
    group.add([0, 1, 2], .75, 'REPLACE')
    s = bpy.context.scene.sh3_morph_transfer
    s.source, s.target = source, target
    s.preview_key = 'Hair bend'
    before = [(tuple(p.co), [(g.group, g.weight) for g in p.groups]) for p in target.data.vertices]
    result, missing = addon.create_preview(s)
    assert missing == 0 and len(result.data.shape_keys.key_blocks) == 2
    assert result.get('sh3_morph_preview') == s.preview_owner
    assert not result.modifiers and result.parent is None
    assert not result.show_only_shape_key and not s.preview_source.show_only_shape_key
    assert source.show_only_shape_key
    assert target.data.shape_keys is None
    assert abs(source.data.shape_keys.key_blocks['Hair bend'].value - .37) < 1e-6
    assert before == [(tuple(p.co), [(g.group, g.weight) for g in p.groups]) for p in target.data.vertices]
    s.preview_value = .2
    assert abs(s.preview_result.data.shape_keys.key_blocks['Hair bend'].value - .2) < 1e-6
    assert abs(s.preview_source.data.shape_keys.key_blocks['Hair bend'].value - .2) < 1e-6
    assert s.preview_source.location.x < s.preview_result.location.x
    original_count = len(bpy.data.objects)
    s.preview_key = 'Cloth flutter'
    assert s.preview_signature != addon.preview_signature(s)
    assert bpy.ops.sh3.morph_preview(action='UPDATE') == {'FINISHED'}
    assert len(bpy.data.objects) == original_count
    assert s.preview_result.data.shape_keys.key_blocks.get('Hair bend') is None
    assert s.preview_signature == addon.preview_signature(s)
    prior = s.preview_result
    s.preview_key = 'Missing key'
    try:
        addon.create_preview(s)
    except ValueError:
        pass
    else:
        raise AssertionError('Missing key accepted')
    assert s.preview_result == prior and len(bpy.data.objects) == original_count
    addon.discard_preview(s)
    assert len(bpy.data.objects) == original_count - 2 and target.name in bpy.data.objects
    assert s.preview_result is None and s.preview_source is None
    result, _ = addon.transfer_settings(s)
    assert {'Hair bend', 'Cloth flutter'} <= set(result.data.shape_keys.key_blocks.keys())


def test_anchor_motion_and_unmatched():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = mesh('Source', [(x, y, 0) for y in range(3) for x in range(3)],
                  [(i, i+1, i+4, i+3) for i in (0, 1, 3, 4)])
    source.shape_key_add(name='Basis')
    key = source.shape_key_add(name='Morph 06')
    for i, p in enumerate(key.data):
        p.co.z = i / 8
    target = mesh('Target', [tuple(p.co) for p in source.data.vertices],
                  [tuple(p.vertices) for p in source.data.polygons])
    target.data.vertices[8].co.y = 20
    result, missing = addon.transfer(source, target, max_distance=.1, smooth_iterations=5,
                                      landmark_indices=[(0, 0), (2, 2), (6, 6)], anchor_radius=4)
    assert missing == 1
    output = result.data.shape_keys.key_blocks['Morph 06']
    for i in [0, 2, 6]:
        assert (output.data[i].co - key.data[i].co).length < 1e-6
    assert (output.data[8].co - target.data.vertices[8].co).length == 0
    assert json.loads(result['sh3_morph_transfer'])['region_coverage'][0]['unmatched'] == 1
    # A non-affine neutral fit must not turn a pure translation into a warped expression.
    source_points = [tuple(p.co) for p in source.data.vertices]
    target_points = [tuple(p.co) for p in source.data.vertices]
    target_points[4] = (1, 1, .4)
    warp = addon.LandmarkWarp(source_points, target_points)
    vectors = warp.displacements([Vector((0, 0, 2))] * len(source_points))
    assert all((v - vectors[0]).length < 1e-8 for v in vectors)


def test_landmark_templates_and_stale_topology():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    source = mesh('Source', points, [(0, 1, 2)])
    target = mesh('Target', points, [(0, 1, 2)])
    s = bpy.context.scene.sh3_morph_transfer
    s.source, s.target, s.match_mode = source, target, 'LANDMARKS'
    for i in range(3):
        pair = s.landmarks.add()
        pair.name = 'Anchor ' + str(i)
        pair.source_vertex = pair.target_vertex = i
        pair.source_topology = addon.topology_signature(source)
        pair.target_topology = addon.topology_signature(target)
    assert addon.paired_landmarks(s)
    replacement = bpy.data.meshes.new('Changed topology')
    replacement.from_pydata(points + [(2, 2, 0)], [], [(0, 1, 2), (1, 2, 3)])
    target.data = replacement
    try:
        addon.paired_landmarks(s)
    except ValueError as error:
        assert 'topology changed' in str(error)
    else:
        raise AssertionError('Stale captured vertices accepted')
    s.landmarks.clear()
    s.template = 'FACE'
    bpy.ops.sh3.landmark(action='TEMPLATE')
    assert len(s.landmarks) == 14
    s.landmarks['Upper lip'].source_vertex = 2
    bpy.ops.sh3.landmark(action='TEMPLATE')
    assert len(s.landmarks) == 14 and s.landmarks['Upper lip'].source_vertex == 2
    s.template = 'HAIR'
    bpy.ops.sh3.landmark(action='TEMPLATE')
    assert 'Strand tip' in s.landmarks


def test_protected_anchor_spread():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = mesh('Close surfaces', [(0, 0, 0), (1, 0, 0), (0, 1, 0),
                                 (0, 0, .01), (1, 0, .01), (0, 1, .01)], [(0, 1, 2), (3, 4, 5)])
    obj.shape_key_add(name='Basis')
    key = obj.shape_key_add(name='Open')
    motion = addon.AnchorMotion(obj, [(0, 0)], 4, [1, 1, 1, 2, 2, 2], [1] * 6)
    motion.apply(key, {0: Vector((0, 0, -1))})
    assert abs(key.data[0].co.z + 1) < 1e-6 and key.data[1].co.z < 0
    assert all((key.data[i].co - obj.data.vertices[i].co).length == 0 for i in (3, 4, 5))


def test_region_feathering():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = mesh('Opposite layers', [(0, 0, .01), (1, 0, .01), (0, 1, .01),
                                     (0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 2), (3, 4, 5)])
    source.shape_key_add(name='Basis')
    key = source.shape_key_add(name='Open')
    for i, p in enumerate(key.data):
        p.co.z += 1 if i < 3 else -1
    src_group = source.vertex_groups.new(name='Upper')
    src_group.add([0, 1, 2], 1, 'REPLACE')
    target = mesh('Target', [(0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 2)])
    dst_group = target.vertex_groups.new(name='Upper')
    for i, w in enumerate((1, .5, .25)):
        dst_group.add([i], w, 'REPLACE')
    result, _ = addon.transfer(source, target, max_distance=1, smooth_iterations=0,
                                regions=[('Upper', 'Upper', 'Upper')])
    actual = [p.co.z for p in result.data.shape_keys.key_blocks['Open'].data]
    assert np.allclose(actual, [1, 0, -.5], atol=1e-6), actual
    warp = addon.LandmarkWarp([(0,0,0),(1,0,0),(0,1,0),(0,0,1)],
                             [(0,0,0),(1,0,0),(0,1,0),(0,0,1.1)])
    remote = np.array([(100,100,100)])
    assert np.array_equal(warp.array(remote), warp.similarity(remote))


def test_feature_region_workflow():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import math
    points = [((1 + r * .2) * math.cos(i * math.tau / 16), 0,
               (.15 + r * .2) * math.sin(i * math.tau / 16)) for r in range(4) for i in range(16)]
    faces = [(r * 16 + i, r * 16 + (i + 1) % 16, (r + 1) * 16 + (i + 1) % 16, (r + 1) * 16 + i)
             for r in range(3) for i in range(16)]
    s = bpy.context.scene.sh3_morph_transfer
    s.source = mesh('Original lip ring', points, faces)
    s.target = mesh('Replacement lip ring', points, faces)
    for name, index in [('Upper lip', 4), ('Lower lip', 12), ('Mouth left', 0), ('Mouth right', 8)]:
        pair = s.landmarks.add()
        pair.name, pair.source_vertex, pair.target_vertex = name, index, index
    s.feature = 'MOUTH'
    addon.suggest_feature_regions(s)
    assert len(s.regions) == 2
    assert all(len(getattr(s, side).vertex_groups) == 2 for side in ('source', 'target'))
    upper = addon.weights(s.target, s.regions[0].target_group)
    lower = addon.weights(s.target, s.regions[1].target_group)
    assert upper[4] == lower[12] == 1
    assert not any(a > 0 and b > 0 for a, b in zip(upper, lower))
    assert any(0 < value < 1 for value in upper + lower)
    for region in s.regions:
        assert all(addon.weights(s.source, region.source_group)[i] == 1 for i in [0, 8])
    addon.suggest_feature_regions(s)
    assert len(s.source.vertex_groups) == len(s.target.vertex_groups) == 2
    s.landmarks['Lower lip'].source_vertex = 5
    try:
        addon.suggest_feature_regions(s)
    except ValueError as error:
        assert 'same edge' in str(error)
    else:
        raise AssertionError('Two points on the same rim edge accepted')
    assert addon.weights(s.target, s.regions[0].target_group) == upper


def test_facial_depth_correction():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    target = mesh('Face', [(-1,0,0),(1,0,0),(0,0,-1),(0,-1,1)], [(0,1,2),(0,1,3)])
    target.shape_key_add(name='Basis')
    for name, delta in [('Mouth open', Vector((0,2,-3))), ('Unrelated morph', Vector((1,0,0)))]:
        key = target.shape_key_add(name=name)
        for p in key.data:
            p.co += delta
    mask = target.vertex_groups.new(name='Lower lip')
    mask.add([0,2,3],1,'REPLACE')
    mask.add([1],.5,'REPLACE')
    s = bpy.context.scene.sh3_morph_transfer
    s.target = target
    for name, i in [('Mouth left',0),('Mouth right',1),('Chin',2),('Nose tip',3)]:
        pair = s.landmarks.add()
        pair.name, pair.target_vertex = name, i
    direction = addon.facial_forward(s)
    assert (direction-Vector((0,-1,0))).length < 1e-6
    result = target.copy()
    result.data = target.data.copy()
    bpy.context.collection.objects.link(result)
    corrections = [('Mouth open','Lower lip',direction,.5,1)]
    addon.apply_depth_corrections(result,target,corrections,{'Mouth open'},[1,1,1,0],{2})
    key = result.data.shape_keys.key_blocks['Mouth open'];base = result.data.shape_keys.reference_key
    deltas = [p.co-q.co for p,q in zip(key.data,base.data)]
    assert np.allclose(deltas,[(0,1,-3),(0,1.5,-3),(0,2,-3),(0,2,-3)])
    assert all((p.co-q.co).length==0 for p,q in zip(result.data.shape_keys.key_blocks['Unrelated morph'].data,target.data.shape_keys.key_blocks['Unrelated morph'].data))
    # The forward direction follows object placement, not a hard-coded world axis.
    target.rotation_euler.z = np.pi / 2
    bpy.context.view_layer.update()
    assert (addon.facial_forward(s)-Vector((1,0,0))).length < 1e-6


test_preview_lifecycle()
test_anchor_motion_and_unmatched()
test_landmark_templates_and_stale_topology()
test_protected_anchor_spread()
test_region_feathering()
test_feature_region_workflow()
test_facial_depth_correction()
addon.unregister()
addon.register()
addon.unregister()
print('MORPH WORKFLOW PASS: preview lifecycle, original data, selected/all keys, anchors, unmatched preservation, templates, topology changes, protected motion, registration')
