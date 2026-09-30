"""Keep FBX animation exchange limited to the channels supported by native ANM."""
from collections import Counter
from inspect import signature

import bpy

from io_scene_fbx import data_types, encode_bin, parse_fbx, import_fbx


PROPERTY_WRITERS = {
    data_types.INT8: 'add_int8', data_types.INT16: 'add_int16',
    data_types.BOOL: 'add_bool', data_types.CHAR: 'add_char',
    data_types.INT32: 'add_int32', data_types.INT64: 'add_int64',
    data_types.FLOAT32: 'add_float32', data_types.FLOAT64: 'add_float64',
    data_types.STRING: 'add_string', data_types.BYTES: 'add_bytes',
    data_types.FLOAT32_ARRAY: 'add_float32_array', data_types.FLOAT64_ARRAY: 'add_float64_array',
    data_types.INT64_ARRAY: 'add_int64_array', data_types.INT32_ARRAY: 'add_int32_array',
    data_types.BOOL_ARRAY: 'add_bool_array', data_types.BYTE_ARRAY: 'add_byte_array',
}


def writable(element):
    """Convert Blender's parsed FBX elements to its binary writer representation."""
    result = encode_bin.FBXElem(element.id)
    for kind, value in zip(element.props_type, element.props):
        getattr(result, PROPERTY_WRITERS[kind])(value)
    result.elems = [writable(child) for child in element.elems]
    return result


def remove_scale_tracks(file):
    """Remove baked scaling curves from our export, retaining static bind transforms."""
    root, version = parse_fbx.parse(str(file))
    groups = {element.id: element for element in root.elems}
    objects = groups[b'Objects']
    connections = groups[b'Connections']
    links = [element.props for element in connections.elems]
    nodes = {link[1] for link in links if len(link) == 4 and link[3] == b'Lcl Scaling'}
    curves = {link[1] for link in links if len(link) == 4 and link[2] in nodes}
    removed = nodes | curves
    counts = Counter(element.id for element in objects.elems if element.props[0] in removed)
    objects.elems[:] = [element for element in objects.elems if element.props[0] not in removed]
    connections.elems[:] = [element for element in connections.elems
                            if element.props[1] not in removed and element.props[2] not in removed]
    for element in groups[b'Definitions'].elems:
        if element.id == b'Count':
            element.props[0] -= len(removed)
        elif element.id == b'ObjectType' and element.props[0] in counts:
            count = next(child for child in element.elems if child.id == b'Count')
            count.props[0] -= counts[element.props[0]]
    encode_bin.write(str(file), writable(root), version)


def import_fbx_animation(file):
    """Convert FBX times using Blender's effective FPS, including fps_base.

    The animation reader's FPS argument owns conversion of seconds into frames.
    Supplying the scene's complete timebase also covers custom and fractional rates.
    The adapter is scoped to this import and leaves the installed add-on unchanged.
    """
    reader = import_fbx.blen_read_animations_action_item
    parameters = signature(reader)
    if 'fps' not in parameters.parameters:
        raise RuntimeError('Unsupported Blender FBX animation reader. Use a supported Blender release or import a .blend scene.')

    def read_animation(*args, **kwargs):
        bound = parameters.bind(*args, **kwargs)
        render = bpy.context.scene.render
        bound.arguments['fps'] = render.fps / render.fps_base
        return reader(*bound.args, **bound.kwargs)

    import_fbx.blen_read_animations_action_item = read_animation
    try:
        bpy.ops.import_scene.fbx(filepath=str(file), use_custom_props=True, anim_offset=0.0,
                                automatic_bone_orientation=False, ignore_leaf_bones=False)
    finally:
        import_fbx.blen_read_animations_action_item = reader
