"""Sample native facial controls from evaluated Blender shape keys."""
import math

import bpy


def bindings(metadata):
    result = {}
    for binding in metadata['morph']['bindings']:
        matches = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.get('sh3_morph_mesh') == binding['name']]
        obj = matches[0] if len(matches) == 1 else None
        if obj is None or obj.data.shape_keys is None:
            raise ValueError(f"Missing morph mesh {binding['name']}. Restore the exported mesh or import only bone motion.")
        for index in binding['targets']:
            name = metadata['morph']['names'][index]
            key = obj.data.shape_keys.key_blocks.get(name)
            if key is None:
                raise ValueError(f"{binding['name']}: missing shape key {name}. Keep the exported shape key names or import only bone motion.")
            key.slider_min = -8
            key.slider_max = 8
            result.setdefault(index, []).append((obj, name))
    return result


def prepare(metadata):
    if metadata.get('morph'):
        for binding in metadata['morph']['bindings']:
            matches = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.data.name == binding['name']]
            if len(matches) != 1:
                raise ValueError(f"Cannot identify imported morph mesh {binding['name']}.")
            matches[0]['sh3_morph_mesh'] = binding['name']
        bindings(metadata)


def sample_morphs(metadata, first, last):
    if not metadata.get('morph'):
        return None
    controls = bindings(metadata)
    samples = []
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        values = []
        for index, name in enumerate(metadata['morph']['names']):
            weights = [(obj.name, obj.evaluated_get(graph).data.shape_keys.key_blocks[key].value) for obj, key in controls.get(index, [])]
            if any(not math.isfinite(value) for _, value in weights):
                raise ValueError(f'{name}, source frame {frame}: non-finite facial weight. Check shape key drivers.')
            if weights and any(abs(value - weights[0][1]) > 1 / 8192 for _, value in weights[1:]):
                raise ValueError(f"{name}, source frame {frame}: conflicting weights on {', '.join(mesh for mesh, _ in weights)}. This native morph drives these meshes together; use the same shape key weight on each, or import only bone motion.")
            values.append(weights[0][1] if weights else 0.0)
        samples.append(values)
    return samples
