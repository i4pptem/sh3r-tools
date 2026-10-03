"""Invertible Blender controls for fixed native PACK camera, prop and light tracks."""
import json
import math
import bpy
from exchange_progress import frames as progress_frames
from mathutils import Vector, Quaternion, Matrix, Euler
from animation_rig import TO_BLENDER, matrix

TRACK = 'sh3_scene_track'


def native_position(value):
    return [-value.x / 50, value.z / 50, value.y / 50]


def display_position(value):
    return Vector((-50 * value[0], 50 * value[2], 50 * value[1]))


def unwrap(value, reference, turn):
    return value + turn * round((reference - value) / turn)


def rotation_toward(direction):
    return direction.to_track_quat('-Z', 'Y') if direction.length_squared else Quaternion()


def read_values(obj, native):
    kind = json.loads(obj[TRACK])['type']
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    values = list(native)
    world = evaluated.matrix_world
    position, rotation, scale = world.decompose()
    if any(abs(value - 1) > 1e-5 for value in scale):
        raise ValueError(obj.name + ': scene channels have no scale. Use location/rotation and the light range controls.')
    if kind == 2:
        original = TO_BLENDER.inverted() @ world @ TO_BLENDER
        original = Matrix.Diagonal((-1, -1, 1, 1)) @ original
        angles = original.to_euler('ZYX', Euler(native[:3], 'ZYX'))
        values[:3], values[3:6] = list(angles), list(original.translation)
    elif kind == 3:
        forward = rotation @ Vector((0, 0, -1))
        distance = float(evaluated['sh3_target_distance'])
        if distance <= 0 or evaluated.data.lens <= 0:
            raise ValueError(obj.name + ': camera target distance and lens must be positive.')
        values[:3], values[3:6] = native_position(position), native_position(position + forward * distance)
        twist = rotation_toward(forward).inverted() @ rotation
        values[6] = unwrap(math.degrees(2 * math.atan2(twist.z, twist.w)), native[6], 360)
        tan_half = evaluated.data.sensor_height / (2 * evaluated.data.lens)
        values[7] = 2 * math.atan(290.9090881347656 / 224 * tan_half / 1.6670000553131104) / 0.01745329238474369
    else:
        light = evaluated.data
        power_unit = 1 if kind == 5 else 1000
        values[3:6] = [channel * light.energy / power_unit for channel in light.color]
        if kind == 5:
            direction = TO_BLENDER.inverted() @ (rotation @ Vector((0, 0, -1)))
            direction *= float(evaluated['sh3_direction_length'])
            values[6:9] = [direction.x, -direction.y, direction.z]
        else:
            values[:3] = native_position(position)
            values[6:8] = [float(evaluated['sh3_near']), float(evaluated['sh3_far'])]
            if kind == 7:
                values[8:11] = native_position(position + rotation @ Vector((0, 0, -float(evaluated['sh3_target_distance']))))
                outer = math.degrees(light.spot_size)
                values[11:13] = [outer * (1 - light.spot_blend), outer * light.spot_blend]
    if not all(math.isfinite(value) for value in values):
        raise ValueError(obj.name + ': non-finite scene channel value.')
    return values


def sample_channel(obj, metadata):
    output = []
    for frame in progress_frames(0, len(metadata['native']) - 1, 'Sampling scene channel · ' + obj.name):
        native = metadata['native'][frame]
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        output.append(read_values(obj, native))
    return output


def mark_channel(obj, track):
    if track.get('readOnly'):
        obj['sh3_held_channel'] = 'This native channel ended before the exported range. Its final pose is shown for reference and is not reimported.'
        return
    obj[TRACK] = json.dumps(track, separators=(',', ':'))
    track['baseline'] = sample_channel(obj, track)
    obj[TRACK] = json.dumps(track, separators=(',', ':'))


def key_property(obj, key, value, frame, description):
    obj[key] = value
    obj.id_properties_ui(key).update(description=description)
    obj.keyframe_insert(data_path='["' + key + '"]', frame=frame)


def light_channel(track):
    kind = track['type']
    name = 'SH3 Light ' + track['id']
    light = bpy.data.lights.new(name, 'SUN' if kind == 5 else 'POINT' if kind == 6 else 'SPOT')
    obj = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_mode = 'QUATERNION'
    previous = None
    for frame in progress_frames(0, len(track['native']) - 1, 'Creating light · ' + name):
        v = track['native'][frame]
        strength = max(1, *v[3:6])
        light.color = [max(0, channel / strength) for channel in v[3:6]]
        light.energy = strength * (1 if kind == 5 else 1000)
        light.keyframe_insert('color', frame=frame)
        light.keyframe_insert('energy', frame=frame)
        if kind == 5:
            direction = TO_BLENDER @ Vector((v[6], -v[7], v[8]))
            rotation = rotation_toward(direction)
            key_property(obj, 'sh3_direction_length', direction.length, frame, 'Native direction magnitude; preserve when rotating the light.')
        else:
            obj.location = display_position(v)
            obj.keyframe_insert('location', frame=frame)
            key_property(obj, 'sh3_near', v[6], frame, 'Native near parameter. Game attenuation starts at max(0, 50 * near - 100).')
            key_property(obj, 'sh3_far', v[7], frame, 'Native far parameter. Game attenuation ends at 50 * far.')
            rotation = Quaternion()
            if kind == 7:
                direction = display_position(v[8:11]) - obj.location
                rotation = rotation_toward(direction)
                key_property(obj, 'sh3_target_distance', direction.length, frame, 'Distance to the native spotlight target, in Blender scene units.')
                outer = v[11] + v[12]
                # Preserve native values through calibration when Blender clamps its visual cone.
                light.spot_size = math.radians(outer)
                light.spot_blend = v[12] / outer if outer else 0
                light.keyframe_insert('spot_size', frame=frame)
                light.keyframe_insert('spot_blend', frame=frame)
        if previous and rotation.dot(previous) < 0:
            rotation.negate()
        previous = rotation.copy()
        obj.rotation_quaternion = rotation
        obj.keyframe_insert('rotation_quaternion', frame=frame)
    obj['sh3_light_scope'] = 'Shared map and actors' if track['modelId'] in (2, 11, 14) else 'Actors only' if track['modelId'] in (1, 10, 13) else 'Native category ' + str(track['modelId'])
    obj['sh3_light_note'] = 'Color and power are editable. Point/spot power 1000 represents native RGB intensity 1. Attenuation and rendering are approximations; edit sh3_near / sh3_far for the game.'
    if kind == 5 and track['modelId'] == 5:
        obj.hide_render = True
        obj['sh3_light_note'] = 'Native category 5 is ignored by the game.'
    return obj
