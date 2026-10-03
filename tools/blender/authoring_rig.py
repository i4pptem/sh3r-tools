"""Build a joint-oriented DCC rest skeleton while preserving evaluated skin transforms."""
import bpy
from exchange_progress import frames as progress_frames, report
from mathutils import Vector, Matrix


def _weighted_centers(rig):
    sums = {bone.name: Vector() for bone in rig.data.bones}
    weights = dict.fromkeys(sums, 0.0)
    inverse = rig.matrix_world.inverted()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
            continue
        groups = {group.index: group.name for group in obj.vertex_groups if group.name in sums}
        transform = inverse @ obj.matrix_world
        for vertex in obj.data.vertices:
            point = transform @ vertex.co
            for group in vertex.groups:
                name = groups.get(group.group)
                if name is not None and group.weight > 0:
                    sums[name] += point * group.weight
                    weights[name] += group.weight
    return {name: point / weights[name] for name, point in sums.items() if weights[name] > 0}


def _joint_tails(rig):
    bones = list(rig.data.bones)
    centers = _weighted_centers(rig)
    span = max((bone.head_local - bones[0].head_local).length for bone in bones)
    minimum = max(span * 1e-6, 1e-6)
    tails = {}
    pending = list(bones)
    while pending:
        bone = pending.pop(0)
        if bone.parent and bone.parent.name not in tails:
            pending.append(bone)
            continue
        head = bone.head_local
        children = [child for child in bone.children if (child.head_local - head).length > minimum]
        chains = [child for child in children if child.children]
        candidates = chains or children
        if len(candidates) == 1:
            tail = candidates[0].head_local.copy()
        elif candidates:
            incoming = head - bone.parent.head_local if bone.parent else Vector()
            if chains and incoming.length > minimum:
                direction = incoming.normalized()
                continuation = max(candidates, key=lambda child: (child.head_local - head).normalized().dot(direction))
                tail = continuation.head_local.copy()
            else:
                tail = sum((child.head_local for child in candidates), Vector()) / len(candidates)
        else:
            tail = centers.get(bone.name, head).copy()
        if (tail - head).length <= minimum:
            direction = head - bone.parent.head_local if bone.parent else Vector()
            if direction.length <= minimum:
                direction = tails[bone.parent.name] - bone.parent.head_local if bone.parent else Vector((0,0,1))
            length = max(minimum, direction.length * .5) if bone.parent else max(span * .05, .1)
            tail = head + direction.normalized() * length
        tails[bone.name] = tail
    return tails


def _oriented_rest(rig, tails):
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    forward = (rig.matrix_world.to_3x3().inverted() @ Vector((0,-1,0))).normalized()
    up = (rig.matrix_world.to_3x3().inverted() @ Vector((0,0,1))).normalized()
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:
        bone.use_connect = False
    for bone in rig.data.edit_bones:
        bone.tail = tails[bone.name]
        axis = (bone.tail - bone.head).normalized()
        bone.align_roll(up if abs(axis.dot(forward)) > .95 else forward)
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in rig.pose.bones:
        bone.custom_shape = None
    rig.data.display_type = 'OCTAHEDRAL'


def disconnect_bones(rig, names):
    """Restore independent translations after FBX auto-connects aligned joints."""
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    names = set(names)
    for bone in rig.data.edit_bones:
        if bone.name in names:
            bone.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def reorient_for_authoring(rig, first=None, last=None):
    """Aim bone Y along joints and bake the same skin transforms in that new basis.

    Without a frame range, preserve the current static pose without creating keys.
    """
    if not rig.data.bones:
        return
    scene = bpy.context.scene
    current = scene.frame_current
    frames = range(first, last + 1) if first is not None else [current]
    helpers = {bone.custom_shape for bone in rig.pose.bones if bone.custom_shape}
    rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
    tails = _joint_tails(rig)
    poses = []
    for frame in progress_frames(frames[0], frames[-1], 'Reading original poses · ' + rig.name):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
        poses.append({bone.name: bone.matrix.copy() for bone in evaluated.pose.bones})
    rig.animation_data_clear()
    _oriented_rest(rig, tails)
    for helper in helpers:
        bpy.data.objects.remove(helper, do_unlink=True)
    changes = {bone.name: rest[bone.name].inverted() @ bone.matrix_local for bone in rig.data.bones}
    rotations = {}
    for frame, pose in zip(progress_frames(frames[0], frames[-1], 'Baking authoring rig · ' + rig.name), poses):
        scene.frame_set(frame)
        worlds = {name: value @ changes[name] for name, value in pose.items()}
        for bone in rig.pose.bones:
            parent = bone.parent
            basis = bone.bone.convert_local_to_pose(
                worlds[bone.name], bone.bone.matrix_local, invert=True,
                parent_matrix=worlds[parent.name] if parent else Matrix.Identity(4),
                parent_matrix_local=parent.bone.matrix_local if parent else Matrix.Identity(4))
            bone.rotation_mode = 'QUATERNION'
            location, rotation, scale = basis.decompose()
            if bone.name in rotations and rotation.dot(rotations[bone.name]) < 0:
                rotation.negate()
            rotations[bone.name] = rotation.copy()
            bone.location, bone.rotation_quaternion, bone.scale = location, rotation, scale
            if first is not None:
                for channel in ['location', 'rotation_quaternion', 'scale']:
                    bone.keyframe_insert(channel, frame=frame, group=bone.name)
    scene.frame_set(current)
    bpy.context.view_layer.update()


def save_authoring_scene(file, rig):
    """Save a self-contained Blender scene framed around the exported character."""
    report('Packing textures and saving Blender file')
    bpy.ops.file.pack_all()
    points = [rig.matrix_world @ bone.head_local for bone in rig.data.bones]
    if points:
        lower = Vector(tuple(min(point[i] for point in points) for i in range(3)))
        upper = Vector(tuple(max(point[i] for point in points) for i in range(3)))
        center, size = (lower + upper) * .5, max((upper - lower).length, 1)
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    space = area.spaces.active
                    space.region_3d.view_location = center
                    space.region_3d.view_distance = size * 1.3
                    space.region_3d.view_rotation = Vector((-.5,-2,.5)).to_track_quat('Z','Y')
                    space.clip_end = size * 20
                    space.shading.color_type = 'TEXTURE'
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(file))
