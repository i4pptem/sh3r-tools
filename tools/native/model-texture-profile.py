"""Extract the import-free x86 model texture extension, including BSS relocations."""
import argparse, hashlib, json, re
from pathlib import Path
import pefile
root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dll', type=Path, default=root/'build/native/model-textures.dll')
parser.add_argument('--output', type=Path, default=root/'build/native/model-texture-runtime-profile.json')
args = parser.parse_args()
binary = args.dll.read_bytes()
pe = pefile.PE(data=binary)
assert pe.FILE_HEADER.Machine == 0x14C and not hasattr(pe, 'DIRECTORY_ENTRY_IMPORT')
sections = {s.Name.rstrip(b'\0'): s for s in pe.sections}
assert set(sections) <= {b'.text', b'.data', b'.reloc'}
text, storage = sections[b'.text'], sections[b'.data']
assert not any(binary[storage.PointerToRawData:storage.PointerToRawData + storage.SizeOfRawData])
blob = binary[text.PointerToRawData:text.PointerToRawData + text.SizeOfRawData]
base = pe.OPTIONAL_HEADER.ImageBase
relocations = []
for block in getattr(pe, 'DIRECTORY_ENTRY_BASERELOC', []):
    for item in block.entries:
        if not item.type: continue
        assert item.type == 3
        offset = item.rva - text.VirtualAddress
        assert 0 <= offset <= len(blob) - 4
        address = int.from_bytes(blob[offset:offset + 4], 'little') - base
        target = text if text.VirtualAddress <= address < text.VirtualAddress + len(blob) else storage
        assert target.VirtualAddress <= address < target.VirtualAddress + max(target.Misc_VirtualSize, target.SizeOfRawData)
        relocations.append(dict(offset=offset, target='code' if target is text else 'storage', relative=address-target.VirtualAddress))
exports = {e.name.decode(): e.address-text.VirtualAddress for e in pe.DIRECTORY_ENTRY_EXPORT.symbols}
patches = [dict(address=address, expected=expected, entry=exports[name]) for address,expected,name in [
    (0x683030, "83ec108b5610", "register_entry"),
    (0x4546a0, "568b742408", "select_entry"),
    (0x454720, "8b4424048b0485f8568400", "resource_get"),
    (0x454740, "8b4424048d0485c8568400", "legacy_address0"),
    (0x454750, "8b4424048b0485c8568400", "legacy_value0"),
    (0x454760, "8b4424048d0485e0568400", "legacy_address1"),
    (0x454770, "8b4424048b0485e0568400", "legacy_value1"),
    (0x454790, "8b4424040fbf0445a0568400", "primary_starts"),
    (0x4547a0, "8b4424040fbf0445ac568400", "primary_ids"),
    (0x4547b0, "8b4424040fbf0445c4568400", "secondary_ids"),
    (0x4547d0, "8b4424040fbf0445c0568400", "secondary_starts"),
    (0x682f48, "8b46388b5658", "release_one_entry"),
    (0x682fe0, "8b4638034658", "release_all_entry"),
    (0x45b9ef, "e95cfdffff", "pool_init_entry"),
]]
source = (root/'tools/native/model-textures.c').read_bytes().replace(b'\r\n',b'\n').replace(b'\r',b'\n')
def constant(name): return int(re.search(rb'^#define '+name.encode()+rb' (\w+)',source,re.M)[1],0)
profile = dict(id='sh3-model-textures-32-v1', slots=constant('SLOTS'), primaryRuns=constant('SLOTS'), secondaryRuns=constant('SLOTS'),
    modelCapacity=constant('MODELS'), resourceCapacity=96+constant('EXTRA_RESOURCES'), storageBytes=max(storage.Misc_VirtualSize,storage.SizeOfRawData),
    code=dict(bytes=blob.hex(),relocations=relocations), entries=exports, patches=patches,
    sourceSha256=hashlib.sha256(source).hexdigest())
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(profile,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(codeBytes=len(blob),storageBytes=profile['storageBytes'],patches=len(patches),relocations=len(relocations))))
