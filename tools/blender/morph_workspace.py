import array
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, str(Path(__file__).parent))
from morph_layout import compact_layout

ATTRIBUTE = 'sh3_correspondence'


def coordinates(mesh):
    values = array.array('f', [0.0]) * (len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', values)
    return values


def correspondence(mesh):
    attribute = mesh.attributes.get(ATTRIBUTE)
    if attribute is None or attribute.domain != 'POINT':
        raise ValueError('Keep the sh3_correspondence point attribute on every base and pose mesh.')
    values = array.array('f', [0.0]) * (len(mesh.vertices) * 3)
    attribute.data.foreach_get('vector', values)
    return values


def topology(mesh):
    return [(polygon.loop_total, tuple(polygon.vertices)) for polygon in mesh.polygons]


def export_workspace(job, root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root / 'model.glb'))
    expected = set(job['metadata']['meshNames'])
    parts = [bpy.context.scene.objects.get(name) for name in job['metadata']['meshNames']]
    if any(obj is None or obj.type != 'MESH' for obj in parts) or {obj.name for obj in parts} != expected:
        raise ValueError('Blender did not preserve every model part name.')
    metadata = {**job['metadata'], 'version': 1, 'parts': []}
    poses = 0
    for obj in parts:
        name = obj.name
        keys = obj.data.shape_keys
        targets = []
        if keys:
            for key in list(keys.key_blocks)[1:]:
                values = array.array('f', [0.0]) * (len(obj.data.vertices) * 3)
                key.data.foreach_get('co', values)
                targets.append((key.name, values))
        basis = coordinates(obj.data)
        active = any(values != basis for _, values in targets)
        if keys:
            obj.shape_key_clear()
        attribute = obj.data.attributes.new(ATTRIBUTE, 'FLOAT_VECTOR', 'POINT')
        count = len(obj.data.vertices)
        labels = [(i + 1) / (count + 1) for i in range(count)]
        attribute.data.foreach_set('vector', [v for i, value in enumerate(labels) for v in (value, value * value, ((i * 2654435761) & 0xffff) / 65535)])
        original_matrix = obj.matrix_world.copy()
        obj['sh3_part'] = name
        obj['sh3_role'] = 'base'
        obj['sh3_original_matrix'] = [v for row in original_matrix for v in row]
        part = {'name': name, 'targets': [name for name, _ in targets] if active else []}
        metadata['parts'].append(part)
        if active:
            for target, values in targets:
                pose = obj.copy()
                pose.data = obj.data.copy()
                pose.name = name + '__' + target.replace(' ', '_')
                bpy.context.collection.objects.link(pose)
                pose.parent = None
                pose.modifiers.clear()
                pose.data.vertices.foreach_set('co', values)
                pose.matrix_world = obj.matrix_world.copy()
                pose['sh3_role'] = 'pose'
                pose['sh3_target'] = target
                pose['sh3_layout_matrix'] = [v for row in pose.matrix_world for v in row]
                poses += 1
        obj['sh3_layout_matrix'] = [v for row in obj.matrix_world for v in row]
        obj.name = name + '__BASE'
    compact_layout(metadata, list(bpy.context.scene.objects))
    for rig in [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']:
        rig.data.pose_position = 'REST'
        rig.hide_set(True)
    metadata['layout'] = 'compact-front-v1'
    bpy.context.scene['sh3_morph_workspace'] = json.dumps(metadata)
    text = bpy.data.texts.new('READ ME - SH3 morph workspace')
    text.write('BASE is column zero; named pose meshes follow in a row.\n'
               'Add an UNAPPLIED Subdivision Surface modifier to the desired BASE only.\n'
               'Silent Hill 3 Tools copies its subdivision settings to every pose on import.\n'
               'Edit pose vertices in Edit Mode. Keep the rig, UVs, vertex groups and sh3_correspondence attribute.\n'
               'Do not Apply Location/Rotation/Scale or independently remesh the poses.\n'
               'Save this .blend, then choose Import morph workspace in Silent Hill 3 Tools.\n')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        if obj.get('sh3_part', '').startswith('Mesh_0_6'):
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
    frame_active()
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'result.blend'))
    return {'parts': len(parts), 'poseMeshes': poses, 'templateHash': metadata['templateHash']}


def frame_active():
    bpy.context.view_layer.update()
    active = bpy.context.view_layer.objects.active
    if active:
        center = sum((active.matrix_world @ Vector(corner) for corner in active.bound_box), Vector()) / 8
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    area.spaces.active.region_3d.view_location = center
                    area.spaces.active.region_3d.view_distance = max(active.dimensions) * 2


def check_transform(obj):
    expected = Matrix([obj['sh3_layout_matrix'][i:i + 4] for i in range(0, 16, 4)])
    if any(abs(obj.matrix_world[r][c] - expected[r][c]) > 1e-5 for r in range(4) for c in range(4)):
        raise ValueError(f'{obj.name}: keep the workspace object transforms; edit vertices or leave Subdivision unapplied.')


def subdivision_settings(obj):
    unsupported = [modifier.type for modifier in obj.modifiers if modifier.type not in {'ARMATURE', 'SUBSURF'}]
    if unsupported:
        raise ValueError(f'{obj.name}: workspace assembly supports Subdivision Surface modifiers; remove {unsupported}.')
    return [{key: getattr(modifier, key) for key in ('subdivision_type', 'levels', 'render_levels', 'uv_smooth', 'boundary_smooth', 'use_creases')} for modifier in obj.modifiers if modifier.type == 'SUBSURF' and modifier.show_viewport]


def apply_subdivision(obj, settings):
    face_budget = len(obj.data.polygons) * 4 ** sum(config['levels'] for config in settings)
    if face_budget > 1000000:
        raise ValueError(f'{obj.name}: subdivision exceeds the one-million-face assembly budget. Reduce the BASE level.')
    obj.modifiers.clear()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for config in settings:
        modifier = obj.modifiers.new('SH3 subdivision', 'SUBSURF')
        for key, value in config.items():
            setattr(modifier, key, value)
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def import_workspace(job, root):
    bpy.ops.wm.open_mainfile(filepath=job['input'], load_ui=False)
    stored = bpy.context.scene.get('sh3_morph_workspace')
    if not stored:
        raise ValueError('Choose a .blend exported with Export morph workspace.')
    metadata = json.loads(stored)
    if metadata.get('version') != 1 or metadata.get('templateHash') != job['metadata']['templateHash']:
        raise ValueError('This workspace belongs to another model template. Export a workspace from the selected model.')
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bases = []
    for part in metadata['parts']:
        matches = [obj for obj in objects if obj.get('sh3_role') == 'base' and obj.get('sh3_part') == part['name']]
        if len(matches) != 1:
            raise ValueError(f"Keep exactly one BASE for {part['name']}.")
        base = matches[0]
        check_transform(base)
        settings = subdivision_settings(base)
        armature = next((modifier.object for modifier in base.modifiers if modifier.type == 'ARMATURE'), None)
        apply_subdivision(base, settings)
        if len(base.data.vertices) > 1000000:
            raise ValueError(f'{base.name}: subdivision exceeds one million vertices.')
        base_topology, labels = topology(base.data), correspondence(base.data)
        if part['targets']:
            base.shape_key_add(name='Basis')
        for target in part['targets']:
            candidates = [obj for obj in objects if obj.get('sh3_role') == 'pose' and obj.get('sh3_part') == part['name'] and obj.get('sh3_target') == target]
            if len(candidates) != 1:
                raise ValueError(f"Keep exactly one pose {part['name']} / {target}.")
            pose = candidates[0]
            check_transform(pose)
            if pose.modifiers:
                raise ValueError(f'{pose.name}: add subdivision to BASE only; pose subdivision is synchronized during import.')
            apply_subdivision(pose, settings)
            if topology(pose.data) != base_topology or correspondence(pose.data) != labels:
                raise ValueError(f'{pose.name}: vertex correspondence differs from BASE. Apply identical topology operations to every pose.')
            key = base.shape_key_add(name=target)
            key.data.foreach_set('co', coordinates(pose.data))
        base.matrix_world = Matrix([base['sh3_original_matrix'][i:i + 4] for i in range(0, 16, 4)])
        base.name = part['name']
        base.data.name = part['name']
        if armature:
            modifier = base.modifiers.new('Armature', 'ARMATURE')
            modifier.object = armature
        bpy.ops.object.select_all(action='DESELECT')
        base.select_set(True)
        bpy.context.view_layer.objects.active = base
        bpy.ops.object.vertex_group_limit_total(limit=3)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bases.append(base)
        print('SH3_PROGRESS Assembled ' + part['name'], flush=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bases:
        obj.select_set(True)
    for rig in [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']:
        rig.hide_set(False)
        rig.data.pose_position = 'POSE'
        rig.select_set(True)
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(filepath=str(root / 'result.glb'), export_format='GLB', use_selection=True, export_animations=False, export_extras=True)
    return {'parts': len(bases), 'templateHash': metadata['templateHash']}


def main():
    job = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
    root = Path(job['folder'])
    try:
        report = {'export': export_workspace, 'import': import_workspace}[job['mode']](job, root)
    except Exception as error:
        (root / 'report.json').write_text(json.dumps({'error': str(error), 'traceback': traceback.format_exc()}), encoding='utf-8')
        raise
    (root / 'report.json').write_text(json.dumps(report), encoding='utf-8')


if __name__ == '__main__':
    main()
