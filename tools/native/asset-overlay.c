/* Native ARC substitution and scoped virtual AFS reads. Included by asi-runtime.c. */
typedef struct { DWORD kind, size, virtualSize, entries; WCHAR path[MAX_PATH]; HANDLE base; } AssetSource;
typedef struct { DWORD source, index, size, offset; char name[1024]; WCHAR path[MAX_PATH]; HANDLE file; } AssetFile;
typedef struct VirtualOpen { HANDLE handle; AssetSource *source; uint64_t position; struct VirtualOpen *next; } VirtualOpen;
static AssetSource *assetSources;
static AssetFile *assetFiles;
static DWORD assetSourceCount, assetCount, *rawBlockLengths;
static VirtualOpen *virtualOpens;
static CRITICAL_SECTION assetLock;
static HANDLE (WINAPI *previousCreateA)(LPCSTR,DWORD,DWORD,LPSECURITY_ATTRIBUTES,DWORD,DWORD,HANDLE);
static HANDLE (WINAPI *previousCreateW)(LPCWSTR,DWORD,DWORD,LPSECURITY_ATTRIBUTES,DWORD,DWORD,HANDLE);
static BOOL (WINAPI *previousRead)(HANDLE,LPVOID,DWORD,LPDWORD,LPOVERLAPPED);
static BOOL (WINAPI *previousClose)(HANDLE);
static DWORD (WINAPI *previousSize)(HANDLE,LPDWORD);
static DWORD (WINAPI *previousSeek)(HANDLE,LONG,PLONG,DWORD);
static BOOL (WINAPI *previousResult)(HANDLE,LPOVERLAPPED,LPDWORD,BOOL);
static HANDLE (WINAPI *previousFind)(LPCSTR,LPWIN32_FIND_DATAA);
typedef void *(__fastcall *ArchiveConstructor)(void *, void *, const char *);
static ArchiveConstructor originalArchiveConstructor=(ArchiveConstructor)0x6097F0;

static void assetString(Reader *r, char *output, DWORD capacity) {
    DWORD bytes=number(r); if(!bytes || bytes>=capacity) fail("Invalid compact asset path length.");
    memcpy(output,take(r,bytes),bytes);output[bytes]=0;
    if(strlen(output)!=bytes) fail("Embedded zero in compact asset path.");
}
static void assetPath(const WCHAR *root, const char *relative, WCHAR result[MAX_PATH]) {
    WCHAR decoded[MAX_PATH],combined[MAX_PATH],absolute[MAX_PATH];
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,relative,-1,decoded,MAX_PATH) ||
       decoded[0]==L'/' || decoded[0]==L'\\' || wcschr(decoded,L':')) fail("Invalid compact asset relative path.");
    for(WCHAR *c=decoded;*c;c++)if(*c==L'/')*c=L'\\';
    if(_snwprintf_s(combined,MAX_PATH,_TRUNCATE,L"%s\\%s",root,decoded)<0) fail("Compact mod path is too long.");
    DWORD length=GetFullPathNameW(combined,MAX_PATH,absolute,NULL);SIZE_T prefix=wcslen(root);
    if(!length || length>=MAX_PATH || _wcsnicmp(root,absolute,prefix) || absolute[prefix]!=L'\\') fail("Compact mod path escapes its folder.");
    wcscpy_s(result,MAX_PATH,absolute);
}
static HANDLE verifiedAssetFile(const WCHAR *path, DWORD size, const BYTE *expected) {
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    LARGE_INTEGER length; HCRYPTPROV provider=0;HCRYPTHASH context=0;DWORD count,hashSize=32;BYTE hash[32];
    if(file==INVALID_HANDLE_VALUE || !GetFileSizeEx(file,&length) || length.QuadPart!=size) fail("Compact mod source or payload is missing or has a different size. Restore its matching base files.");
    BYTE *buffer=HeapAlloc(GetProcessHeap(),0,1024*1024);if(!buffer)fail("Not enough memory to verify compact assets.");
    if(!CryptAcquireContextW(&provider,NULL,NULL,PROV_RSA_AES,CRYPT_VERIFYCONTEXT)||!CryptCreateHash(provider,CALG_SHA_256,0,0,&context))fail("Cannot hash compact assets.");
    do {if(!ReadFile(file,buffer,1024*1024,&count,NULL)||!CryptHashData(context,buffer,count,0))fail("Cannot verify compact asset bytes.");} while(count);
    if(!CryptGetHashParam(context,HP_HASHVAL,hash,&hashSize,0))fail("Cannot finish compact asset verification.");
    CryptDestroyHash(context);CryptReleaseContext(provider,0);HeapFree(GetProcessHeap(),0,buffer);
    if(memcmp(hash,expected,32))fail("Compact asset checksum differs. Use the original archives used for this mod and its complete replacement files.");
    return file;
}
static void readAssetSources(Reader *r,const WCHAR *game) {
    for(DWORD i=0;i<assetSourceCount;i++){
        AssetSource *source=assetSources+i;char relative[1024];WCHAR conflict[MAX_PATH];
        source->kind=number(r);source->size=number(r);source->virtualSize=number(r);assetString(r,relative,sizeof(relative));
        if((source->kind!=1&&source->kind!=2)||!source->size||source->virtualSize<source->size || strncmp(relative,"data/",5))fail("Invalid compact archive descriptor.");
        assetPath(game,relative,source->path);assetPath(directory,relative,conflict);
        if(GetFileAttributesW(conflict)!=INVALID_FILE_ATTRIBUTES)fail("A full archive overlay conflicts with compact assets for the same archive. Remove the old build files before installing this mod.");
        for(DWORD n=0;n<i;n++)if(!_wcsicmp(source->path,assetSources[n].path))fail("Duplicate compact archive source.");
        source->base=verifiedAssetFile(source->path,source->size,take(r,32));
        if(source->kind==2){DWORD header[2],read;SetFilePointer(source->base,0,NULL,FILE_BEGIN);
            if(!ReadFile(source->base,header,8,&read,NULL)||read!=8||header[0]!=0x00534641||header[1]>100000||(uint64_t)8+header[1]*8>source->size)fail("Invalid original AFS directory.");source->entries=header[1];}

    }
}
static void readAssetFiles(Reader *r) {
    DWORD largest=0;
    for(DWORD i=0;i<assetCount;i++){
        AssetFile *file=assetFiles+i;char relative[1024];
        file->source=number(r);file->index=number(r);assetString(r,file->name,sizeof(file->name));assetString(r,relative,sizeof(relative));
        file->size=number(r);file->offset=number(r);
        if(file->source>=assetSourceCount||!file->size||file->size>256*1024*1024 || strncmp(relative,"data/",5))fail("Invalid compact payload descriptor.");
        AssetSource *source=assetSources+file->source;
        if(source->kind==1){if(strncmp(file->name,"data/",5)||file->offset)fail("Invalid native ARC asset name.");}
        else if(file->index>=source->entries || (uint64_t)8+file->index*8+8>source->size || file->offset<source->size || file->offset%2048 || (uint64_t)file->offset+file->size>source->virtualSize)fail("Invalid virtual AFS payload bounds.");
        for(DWORD n=0;n<i;n++){
            AssetFile *other=assetFiles+n;
            if((source->kind==1&&!_stricmp(other->name,file->name))||(other->source==file->source&&other->index==file->index))fail("Duplicate compact asset identity.");
            if(source->kind==2&&other->source==file->source&&file->offset<(uint64_t)other->offset+other->size&&other->offset<(uint64_t)file->offset+file->size)fail("Overlapping virtual AFS payloads.");
        }
        assetPath(directory,relative,file->path);file->file=verifiedAssetFile(file->path,file->size,take(r,32));
        if(source->kind==1&&file->size>largest)largest=file->size;
    }
    rawBlockLengths=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,((largest+65535)/65536+1)*4);
    if(!rawBlockLengths)fail("Cannot allocate native asset block metadata.");
}
static void * __fastcall compactArchive(void *object,void *unused,const char *path) {
    (void)unused;void *result=originalArchiveConstructor(object,NULL,path);char normalized[1024];
    if(!path||strnlen_s(path,sizeof(normalized))>=sizeof(normalized))return result;
    strcpy_s(normalized,sizeof(normalized),path);for(char *c=normalized;*c;c++)if(*c=='\\')*c='/';
    for(DWORD i=0;i<assetCount;i++){
        AssetFile *file=assetFiles+i;if(assetSources[file->source].kind!=1||_stricmp(normalized,file->name))continue;
        DWORD *fields=(DWORD *)result;
        if(!result||fields[0]!=0x699974 || (HANDLE)fields[3]==INVALID_HANDLE_VALUE)fail("Original ARC resource could not be opened. Compact substitution requires its matching game catalog.");
        HANDLE replacement=CreateFileW(file->path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
        if(replacement==INVALID_HANDLE_VALUE)fail("A compact ARC replacement could not be opened.");
        CloseHandle((HANDLE)fields[3]);fields[3]=(DWORD)replacement;fields[4]=0;fields[5]=file->size;fields[6]=0;fields[7]=(DWORD)rawBlockLengths;
        return result;
    }
    return result;
}
static AssetSource *virtualPathW(LPCWSTR path) {
    WCHAR absolute[MAX_PATH];DWORD length=GetFullPathNameW(path,MAX_PATH,absolute,NULL);
    if(!length||length>=MAX_PATH)return NULL;
    for(DWORD i=0;i<assetSourceCount;i++)if(assetSources[i].kind==2&&!_wcsicmp(absolute,assetSources[i].path))return assetSources+i;
    return NULL;
}
static AssetSource *virtualPathA(LPCSTR path) {
    WCHAR wide[MAX_PATH];if(!MultiByteToWideChar(CP_ACP,0,path,-1,wide,MAX_PATH))return NULL;return virtualPathW(wide);
}
static VirtualOpen *virtualHandle(HANDLE handle) {for(VirtualOpen *p=virtualOpens;p;p=p->next)if(p->handle==handle)return p;return NULL;}
static HANDLE registerVirtual(HANDLE handle,AssetSource *source) {
    if(handle==INVALID_HANDLE_VALUE||!source)return handle;
    VirtualOpen *record=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*record));if(!record)fail("Cannot allocate virtual AFS handle.");
    record->handle=handle;record->source=source;EnterCriticalSection(&assetLock);record->next=virtualOpens;virtualOpens=record;LeaveCriticalSection(&assetLock);return handle;
}
static BOOL virtualAccess(AssetSource *source,DWORD access,DWORD creation) {
    if(source&&((access&(GENERIC_WRITE|DELETE|FILE_WRITE_DATA|FILE_APPEND_DATA))||creation!=OPEN_EXISTING)){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}return TRUE;
}
static HANDLE WINAPI compactCreateA(LPCSTR path,DWORD access,DWORD share,LPSECURITY_ATTRIBUTES security,DWORD creation,DWORD flags,HANDLE templateFile) {
    AssetSource *source=virtualPathA(path);if(!virtualAccess(source,access,creation))return INVALID_HANDLE_VALUE;
    return registerVirtual(previousCreateA(path,access,share,security,creation,flags,templateFile),source);
}
static HANDLE WINAPI compactCreateW(LPCWSTR path,DWORD access,DWORD share,LPSECURITY_ATTRIBUTES security,DWORD creation,DWORD flags,HANDLE templateFile) {
    AssetSource *source=virtualPathW(path);if(!virtualAccess(source,access,creation))return INVALID_HANDLE_VALUE;
    return registerVirtual(previousCreateW(path,access,share,security,creation,flags,templateFile),source);
}
static BOOL backendRead(HANDLE file,uint64_t offset,BYTE *target,DWORD size) {
    LARGE_INTEGER at;DWORD read;at.QuadPart=offset;
    if(!SetFilePointerEx(file,at,NULL,FILE_BEGIN)||!ReadFile(file,target,size,&read,NULL))return FALSE;
    if(read!=size){SetLastError(ERROR_READ_FAULT);return FALSE;}return TRUE;
}
static BOOL intersectRead(HANDLE file,uint64_t start,DWORD size,uint64_t offset,DWORD length,BYTE *output) {
    uint64_t first=offset>start?offset:start,end=offset+length,limit=start+size;if(end>limit)end=limit;
    return first>=end || backendRead(file,first-start,output+(SIZE_T)(first-offset),(DWORD)(end-first));
}
static BOOL virtualRead(VirtualOpen *record,BYTE *output,DWORD requested,uint64_t offset,DWORD *read) {
    AssetSource *source=record->source;*read=offset>=source->virtualSize?0:(DWORD)(((uint64_t)source->virtualSize-offset)<requested?source->virtualSize-offset:requested);
    if(!*read)return TRUE;memset(output,0,*read);
    if(!intersectRead(source->base,0,source->size,offset,*read,output))return FALSE;
    for(DWORD i=0;i<assetCount;i++)if(assetFiles[i].source==(DWORD)(source-assetSources)){
        AssetFile *file=assetFiles+i;DWORD table[2]={file->offset,file->size};uint64_t at=8+(uint64_t)file->index*8,first=offset>at?offset:at,end=offset+*read;
        if(end>at+8)end=at+8;if(first<end)memcpy(output+(SIZE_T)(first-offset),(BYTE *)table+(SIZE_T)(first-at),(SIZE_T)(end-first));
        if(!intersectRead(file->file,file->offset,file->size,offset,*read,output))return FALSE;
    }
    return TRUE;
}
static BOOL WINAPI compactRead(HANDLE handle,LPVOID data,DWORD size,LPDWORD read,LPOVERLAPPED overlapped) {
    EnterCriticalSection(&assetLock);VirtualOpen *record=virtualHandle(handle);
    if(!record){LeaveCriticalSection(&assetLock);return previousRead(handle,data,size,read,overlapped);}
    DWORD transferred=0;uint64_t offset=overlapped?((uint64_t)overlapped->OffsetHigh<<32)|overlapped->Offset:record->position;
    BOOL ok=virtualRead(record,data,size,offset,&transferred);DWORD error=ok?ERROR_SUCCESS:GetLastError();if(!ok)transferred=0;
    if(read)*read=transferred;if(!overlapped&&ok)record->position+=transferred;
    if(overlapped){overlapped->Internal=ok?0:0xc0000185;overlapped->InternalHigh=transferred;if(overlapped->hEvent)SetEvent((HANDLE)((uintptr_t)overlapped->hEvent&~(uintptr_t)1));}
    LeaveCriticalSection(&assetLock);SetLastError(error);return ok;
}
static BOOL WINAPI compactResult(HANDLE handle,LPOVERLAPPED overlapped,LPDWORD read,BOOL wait) {
    EnterCriticalSection(&assetLock);BOOL tracked=virtualHandle(handle)!=NULL;LeaveCriticalSection(&assetLock);
    if(!tracked)return previousResult(handle,overlapped,read,wait);
    if(!overlapped||!read){SetLastError(ERROR_INVALID_PARAMETER);return FALSE;}*read=(DWORD)overlapped->InternalHigh;
    if(overlapped->Internal){SetLastError(ERROR_READ_FAULT);return FALSE;}SetLastError(ERROR_SUCCESS);return TRUE;
}
static DWORD WINAPI compactSize(HANDLE handle,LPDWORD high) {
    EnterCriticalSection(&assetLock);VirtualOpen *record=virtualHandle(handle);DWORD result=record?record->source->virtualSize:0;
    LeaveCriticalSection(&assetLock);if(!record)return previousSize(handle,high);if(high)*high=0;SetLastError(NO_ERROR);return result;
}
static DWORD WINAPI compactSeek(HANDLE handle,LONG low,PLONG high,DWORD origin) {
    EnterCriticalSection(&assetLock);VirtualOpen *record=virtualHandle(handle);
    if(!record){LeaveCriticalSection(&assetLock);return previousSeek(handle,low,high,origin);}
    int64_t distance=high?((int64_t)*high*4294967296LL+(DWORD)low):low;
    int64_t base=origin==FILE_BEGIN?0:origin==FILE_CURRENT?(int64_t)record->position:origin==FILE_END?(int64_t)record->source->virtualSize:-1;
    if(base<0||distance<-base||distance>INT64_MAX-base){LeaveCriticalSection(&assetLock);SetLastError(ERROR_NEGATIVE_SEEK);return INVALID_SET_FILE_POINTER;}
    record->position=(uint64_t)(base+distance);DWORD result=(DWORD)record->position;if(high)*high=(LONG)(record->position>>32);
    LeaveCriticalSection(&assetLock);SetLastError(NO_ERROR);return result;
}
static BOOL WINAPI compactClose(HANDLE handle) {
    EnterCriticalSection(&assetLock);VirtualOpen **p=&virtualOpens;
    while(*p&&(*p)->handle!=handle)p=&(*p)->next;
    if(*p){VirtualOpen *old=*p;*p=old->next;BOOL result=previousClose(handle);HeapFree(GetProcessHeap(),0,old);LeaveCriticalSection(&assetLock);return result;}
    LeaveCriticalSection(&assetLock);return previousClose(handle);
}
static HANDLE WINAPI compactFind(LPCSTR path,LPWIN32_FIND_DATAA data) {
    HANDLE handle=previousFind(path,data);AssetSource *source=virtualPathA(path);
    if(handle!=INVALID_HANDLE_VALUE&&source){data->nFileSizeHigh=0;data->nFileSizeLow=source->virtualSize;}return handle;
}
static void replaceAssetCode(BYTE *address,const BYTE *bytes,DWORD size) {
    DWORD old,unused;if(!VirtualProtect(address,size,PAGE_EXECUTE_READWRITE,&old))fail("Cannot install compact asset hook.");
    memcpy(address,bytes,size);if(!VirtualProtect(address,size,old,&unused))fail("Cannot protect compact asset hook.");
}
static void installAssetHooks(void) {
    BOOL hasArc=FALSE,hasAfs=FALSE;for(DWORD i=0;i<assetSourceCount;i++){hasArc|=assetSources[i].kind==1;hasAfs|=assetSources[i].kind==2;}
    if(hasArc){BYTE *at=(BYTE *)0x606928,expected[]={0xe8,0xc3,0x2e,0,0},call[5]={0xe8};
        if(memcmp(at,expected,5))fail("Native ARC loader hook conflicts with another mod.");
        DWORD displacement=(DWORD)(uintptr_t)compactArchive-(DWORD)(uintptr_t)at-5;memcpy(call+1,&displacement,4);replaceAssetCode(at,call,5);
    }
    if(hasAfs){
        struct {DWORD address;void *hook;void **previous;} hooks[]={
          {0x68a120,compactCreateA,(void **)&previousCreateA},{0x68a224,compactCreateW,(void **)&previousCreateW},
          {0x68a118,compactRead,(void **)&previousRead},{0x68a060,compactClose,(void **)&previousClose},
          {0x68a11c,compactSize,(void **)&previousSize},{0x68a124,compactSeek,(void **)&previousSeek},
          {0x68a204,compactResult,(void **)&previousResult},{0x68a1e4,compactFind,(void **)&previousFind}};
        for(DWORD i=0;i<sizeof(hooks)/sizeof(hooks[0]);i++){*hooks[i].previous=*(void **)hooks[i].address;replaceAssetCode((BYTE *)hooks[i].address,(BYTE *)&hooks[i].hook,4);}
    }
    FlushInstructionCache(GetCurrentProcess(),NULL,0);
}
static BOOL loadCompactAssets(const WCHAR *game) {
    WCHAR path[MAX_PATH];DWORD size;BYTE hash[32];
    _snwprintf_s(path,MAX_PATH,_TRUNCATE,L"%s\\SH3Tools.assets",directory);
    if(GetFileAttributesW(path)==INVALID_FILE_ATTRIBUTES)return FALSE;
    BYTE *file=readFile(path,4*1024*1024+32,&size);if(size<52)fail("Truncated compact asset index.");
    hashBytes(file,size-32,hash);if(memcmp(hash,file+size-32,32))fail("Compact asset index checksum differs.");
    Reader reader={file,file+size-32};
    if(memcmp(take(&reader,8),"SH3DATA1",8)||number(&reader)!=1)fail("Unsupported compact asset index.");
    assetSourceCount=number(&reader);assetCount=number(&reader);
    if(assetSourceCount>512||assetCount>32768)fail("Compact asset index exceeds supported limits.");
    assetSources=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,(assetSourceCount+1)*sizeof(*assetSources));
    assetFiles=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,(assetCount+1)*sizeof(*assetFiles));
    if(!assetSources||!assetFiles)fail("Cannot allocate compact asset index.");InitializeCriticalSection(&assetLock);
    readAssetSources(&reader,game);readAssetFiles(&reader);if(reader.next!=reader.end)fail("Unexpected compact asset index data.");
    HeapFree(GetProcessHeap(),0,file);return TRUE;
}

static void initializeCompactAssets(void) {
    WCHAR game[MAX_PATH];DWORD length=GetModuleFileNameW(NULL,game,MAX_PATH);
    if(!length||length>=MAX_PATH||!wcsrchr(game,L'\\'))fail("Unsupported game path.");*wcsrchr(game,L'\\')=0;
    if(loadCompactAssets(game)){installAssetHooks();logMessage("Compact assets active: native ARC replacements and virtual AFS extents; no full archives materialized.");}
}
