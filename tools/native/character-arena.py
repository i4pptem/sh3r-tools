"""Reproduce the import-free x86 character arena patch profile with Python 3.

The getter shims preserve the original pool descriptor and its initialization
state. Only character storage moves. The block shim keeps the unchanged native
occupancy table within its 5120 entries.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys

CODE, ARENA, CAPACITY, BLOCKS = 0x10000000, 0x10002000, 0x08000000, 5120

class Code:
    def __init__(self, base):
        self.base, self.data, self.labels, self.references, self.relocations = base, bytearray(), {}, [], []

    def emit(self, text):
        self.data.extend(bytes.fromhex(text))

    def absolute(self, value, relocate=False):
        if relocate:
            self.relocations.append(len(self.data))
        self.data.extend(struct.pack('<I', value))

    def label(self, name):
        self.labels[name] = len(self.data)

    def branch(self, opcode, target):
        self.emit(opcode)
        self.references.append((len(self.data), target))
        self.data.extend(bytes(4))

    def finish(self):
        for offset, target in self.references:
            address = self.base+self.labels[target] if isinstance(target, str) else target
            struct.pack_into('<i', self.data, offset, address-(self.base+offset+4))
        return bytes(self.data)


def make_profile():
    out = Code(CODE)
    out.label('base')
    out.emit('3d'); out.absolute(0x72156c)
    out.branch('0f85', 'base_original')
    out.emit('83780800')
    out.branch('0f84', 'base_original')
    out.emit('b8'); out.absolute(ARENA, True)
    out.emit('33d2')
    out.branch('e9', 0x5f60f5)
    out.label('base_original')
    out.emit('8b400833d2')
    out.branch('e9', 0x5f60f5)

    out.label('size')
    out.emit('81f9'); out.absolute(0x72156c)
    out.branch('0f85', 'size_original')
    out.emit('83790800')
    out.branch('0f84', 'size_original')
    out.emit('8b5108b8'); out.absolute(CAPACITY)
    out.emit('85d2c3')
    out.label('size_original')
    out.emit('8b510833c0')
    out.branch('e9', 0x5f6115)

    out.label('blocks')
    out.emit('85c0')
    out.branch('0f89', 'blocks_nonnegative')
    out.emit('33c0')
    out.label('blocks_nonnegative')
    out.emit('c1e80d3d'); out.absolute(BLOCKS)
    out.branch('0f86', 'blocks_ready')
    out.emit('b8'); out.absolute(BLOCKS)
    out.label('blocks_ready')
    out.emit('6a08')
    out.branch('e9', 0x59d37a)
    body = out.finish()
    patches = []
    for address, expected, name in [(0x5f60f0, '8b400833d2', 'base'),
                                    (0x5f6110, '8b510833c0', 'size'),
                                    (0x59d375, 'c1e80d6a08', 'blocks')]:
        replacement = b'\xe9'+struct.pack('<i', CODE+out.labels[name]-address-5)
        patches.append(dict(address=address, expected=expected, replacement=replacement.hex(), entry=out.labels[name]))
    external_branches = [offset for offset,target in out.references if not isinstance(target,str)]
    return dict(id='sh3-character-arena-128m-v1', imageBase=0x400000, descriptor=0x72156c,
                arenaBytes=CAPACITY, arenaAlignment=8192, maxCacheBlocks=BLOCKS,
                base=CODE, arena=ARENA, code=body.hex(), arenaPointerRelocations=out.relocations,
                externalRelativeBranches=external_branches, entries=out.labels, patches=patches)

if __name__ == '__main__':
    generated = make_profile()
    generated['sourceSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if '--check' in sys.argv:
        stored = json.loads((Path(__file__).resolve().parents[2] / 'core/character-runtime-profile.json').read_text())
        if generated != stored:
            raise SystemExit('Character runtime source and profile differ.')
        print('Character runtime profile matches its source.')
    else:
        print(json.dumps(generated, indent=2))
