"""Generate verified x86 preflight shims for the shared transparent queue."""
from pathlib import Path
import struct, json, hashlib
base=0x10010000
streams=[(0x5f5990,0xc007a4),(0x5f58e0,0xc007b8),(0x5f5a30,0xc007cc)]
code=bytearray(); branches=[]; patches=[]
def word(value): return struct.pack('<I',value&0xffffffff)
for address,stream in streams:
    while len(code)%64: code.append(0x90)
    start=len(code); local=bytearray();labels={};fixups=[]
    def emit(value): local.extend(bytes.fromhex(value))
    def branch(op,label): emit(op);fixups.append((len(local),label));local.append(0)
    emit('9c 60 80 3d');local.extend(word(0xc00844));emit('00');branch('74','restore')
    emit('8b 44 24 28 8b 0d');local.extend(word(stream+12));emit('03 c8 3b 0d');local.extend(word(stream+8));branch('7f','flush')
    emit('81 3d');local.extend(word(0xc007a0)+word(4096));branch('7c','restore')
    labels['flush']=len(local);emit('e8');at=start+len(local);branches.append(at);local.extend(word(0x5f5620-base-at-4))
    labels['restore']=len(local);emit('61 9d a0');local.extend(word(0xc00844));emit('e9');at=start+len(local);branches.append(at);local.extend(word(address+5-base-at-4))
    for at,label in fixups: local[at]=labels[label]-at-1
    code.extend(local);patches.append(dict(address=address,expected='a04408c000',entry=start,kind='jump'))
source=Path(__file__).read_text(encoding='utf-8').replace('\r\n','\n')
profile=dict(id='sh3-map-transparent-preflight-v1',imageBase=0x400000,base=base,code=code.hex(),externalRelativeBranches=branches,patches=patches,sourceSha256=hashlib.sha256(source.encode()).hexdigest(),limits=dict(queueDescriptors=4096,mapStreamVertices=8192,effect28Vertices=4096,effect24Vertices=64))
(Path(__file__).parents[2]/'core/map-geometry-runtime-profile.json').write_text(json.dumps(profile,indent=2)+'\n',encoding='utf-8')
