from mathutils import Matrix, Vector


def original_matrix(obj):
    values = obj['sh3_original_matrix']
    return Matrix([values[i:i + 4] for i in range(0, 16, 4)])


def bounds(obj):
    transform = original_matrix(obj)
    points = [transform @ vertex.co for vertex in obj.data.vertices]
    return (Vector(tuple(min(p[axis] for p in points) for axis in range(3))),
            Vector(tuple(max(p[axis] for p in points) for axis in range(3))))


def compact_layout(metadata, objects):
    """Arrange pose rows by their own geometry bounds in Blender's front-view plane."""
    bases = {obj['sh3_part']: obj for obj in objects if obj.get('sh3_role') == 'base'}
    poses = {(obj['sh3_part'], obj['sh3_target']): obj for obj in objects if obj.get('sh3_role') == 'pose'}
    boxes = {obj.name: bounds(obj) for obj in [*bases.values(), *poses.values()]}
    right = max(boxes[obj.name][1].x for obj in bases.values())
    top = max(boxes[obj.name][1].z for obj in bases.values())
    for part in metadata['parts']:
        base = bases[part['name']]
        row = [base] + [poses[part['name'], target] for target in part['targets']]
        if part['targets']:
            sizes = [boxes[obj.name][1] - boxes[obj.name][0] for obj in row]
            gap = max(max(max(size.x, size.z) for size in sizes) * 0.12, 1.0)
            cursor = right + gap
            height = max(size.z for size in sizes)
            for obj in row:
                low, high = boxes[obj.name]
                obj.matrix_world = original_matrix(obj)
                obj.matrix_world.translation += Vector((cursor - low.x, 0, top - high.z))
                cursor += high.x - low.x + gap
            top -= height + gap
        else:
            base.matrix_world = original_matrix(base)
        for obj in row:
            obj['sh3_layout_matrix'] = [value for line in obj.matrix_world for value in line]
    return {'rows': sum(bool(part['targets']) for part in metadata['parts'])}
