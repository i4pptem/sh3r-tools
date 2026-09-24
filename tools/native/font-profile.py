"""Extract the linked, import-free x86 font uploader into a relocatable patch profile."""
import argparse
import hashlib
import json
from pathlib import Path
import pefile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dll', type=Path, default=root/'build/native/font-upload.dll')
parser.add_argument('--output', type=Path, default=root/'build/native/font-runtime-profile.json')
args = parser.parse_args()
file = args.dll
binary = file.read_bytes()
pe = pefile.PE(data=binary)
assert pe.FILE_HEADER.Machine == 0x14c
assert not hasattr(pe, 'DIRECTORY_ENTRY_IMPORT')
text = next(section for section in pe.sections if section.Name.rstrip(b'\0') == b'.text')
assert all(section.Name.rstrip(b'\0') in {b'.text', b'.reloc'} for section in pe.sections)
blob = binary[text.PointerToRawData:text.PointerToRawData + text.SizeOfRawData]
export = next(symbol for symbol in pe.DIRECTORY_ENTRY_EXPORT.symbols if symbol.name == b'font_upload')
relocations = []
for block in getattr(pe, 'DIRECTORY_ENTRY_BASERELOC', []):
    for item in block.entries:
        if not item.type:
            continue
        assert item.type == 3
        offset = item.rva - text.VirtualAddress
        assert 0 <= offset <= len(blob) - 4
        value = int.from_bytes(blob[offset:offset + 4], 'little')
        assert pe.OPTIONAL_HEADER.ImageBase + text.VirtualAddress <= value < pe.OPTIONAL_HEADER.ImageBase + text.VirtualAddress + len(blob)
        relocations.append(offset)
profile = dict(id='sh3-hires-font-v1', scale=4, textureSize=2048,
               decoder=dict(address=0x5FA730, expected='83ec245355'),
               patches=[dict(address=0x5FCA74, expected='68000200006800020000', replacement='68000800006800080000')],
               code=dict(base=pe.OPTIONAL_HEADER.ImageBase + text.VirtualAddress,
                         entry=export.address - text.VirtualAddress, relocations=relocations, bytes=blob.hex()),
               sourceSha256=hashlib.sha256((root/'tools/native/font-upload.c').read_bytes()).hexdigest())
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(profile, indent=2)+'\n', encoding='utf-8')
print(json.dumps({**profile, 'code': dict(bytes=len(blob), entry=profile['code']['entry'], relocations=relocations)}, indent=2))
