#define SH3TOOLS_TEST
#include "asi-runtime.c"
#include <assert.h>
static void check(BOOL value,const char *what){if(!value){fprintf(stderr,"FAILED: %s (%lu)\n",what,GetLastError());ExitProcess(40);}}
static void * __fastcall fakeArchive(void *object,void *unused,const char *path){
    (void)unused;(void)path;DWORD *fields=object;memset(fields,0,32);fields[0]=0x699974;
    fields[3]=(DWORD)CreateFileW(assetSources[0].path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);fields[5]=5;fields[6]=123;return object;
}
int wmain(int argc,WCHAR **argv){
    if(argc!=2)return 1;_snwprintf_s(directory,MAX_PATH,_TRUNCATE,L"%s\\plugins\\SH3Tools",argv[1]);
    check(loadCompactAssets(argv[1]),"load index");
    previousCreateA=CreateFileA;previousCreateW=CreateFileW;previousRead=ReadFile;previousClose=CloseHandle;
    previousSize=GetFileSize;previousSeek=SetFilePointer;previousResult=GetOverlappedResult;previousFind=FindFirstFileA;
    originalArchiveConstructor=fakeArchive;
    DWORD reader[8];check(compactArchive(reader,NULL,"DATA\\PCCHR\\TEST.MDL")==reader,"native ARC construction");
    check(reader[5]==assetFiles[0].size&&reader[6]==0&&reader[4]==0,"native ARC size and offsets");
    for(DWORD i=0;i<(reader[5]+65535)/65536;i++)check(((DWORD *)reader[7])[i]==0,"all 64KiB blocks raw");
    BYTE arc[32];DWORD got;check(ReadFile((HANDLE)reader[3],arc,32,&got,NULL)&&got==32&&arc[0]==0x42,"native ARC handle bytes");CloseHandle((HANDLE)reader[3]);
    compactArchive(reader,NULL,"data/pcchr/unmodified.mdl");check(reader[5]==5&&reader[6]==123,"unmodified native ARC passthrough");CloseHandle((HANDLE)reader[3]);
    WCHAR name[MAX_PATH];_snwprintf_s(name,MAX_PATH,_TRUNCATE,L"%s\\data\\demo.afs",argv[1]);
    HANDLE a=compactCreateW(name,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|FILE_FLAG_NO_BUFFERING|FILE_FLAG_RANDOM_ACCESS,NULL);
    HANDLE b=compactCreateW(name,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);check(a!=INVALID_HANDLE_VALUE&&b!=INVALID_HANDLE_VALUE,"independent AFS handles");
    _snwprintf_s(name,MAX_PATH,_TRUNCATE,L"%s\\expected.afs",argv[1]);DWORD length;BYTE *expected=readFile(name,1024*1024,&length);
    check(compactSize(a,NULL)==length,"virtual size");BYTE buffer[4096];DWORD random=12345;
    HANDLE event=CreateEventW(NULL,TRUE,FALSE,NULL);
    for(int i=0;i<300;i++){
        random=random*1664525+1013904223;DWORD offset=random%(length+200),size=(random>>16)%4096,want=offset>=length?0:min(size,length-offset);
        OVERLAPPED ov={0};ov.Offset=offset;ov.hEvent=event;ResetEvent(event);
        check(compactRead(a,buffer,size,&got,&ov)&&got==want,"overlapped interval read");
        check(!memcmp(buffer,expected+min(offset,length),want),"virtual interval bytes");
        check(WaitForSingleObject(event,0)==WAIT_OBJECT_0,"completion event");DWORD completed;check(compactResult(a,&ov,&completed,FALSE)&&completed==want,"completion result");
        check(compactSeek(a,0,NULL,FILE_CURRENT)==0,"async read preserves cursor");
    }
    check(compactSeek(b,-16,NULL,FILE_END)==length-16,"seek relative to virtual EOF");
    check(compactRead(b,buffer,32,&got,NULL)&&got==16&&!memcmp(buffer,expected+length-16,16),"sync EOF clipping");
    check(compactSeek(b,-(LONG)length-1,NULL,FILE_BEGIN)==INVALID_SET_FILE_POINTER&&GetLastError()==ERROR_NEGATIVE_SEEK,"negative seek rejection");
    LONG high=1;check(compactSeek(b,100,&high,FILE_BEGIN)==100&&high==1,"64-bit position");check(compactRead(b,buffer,32,&got,NULL)&&got==0,"large offset EOF");
    check(compactClose(a)&&compactClose(b)&&!virtualOpens,"close tracking");CloseHandle(event);HeapFree(GetProcessHeap(),0,expected);
    puts("Native ARC and 300 virtual AFS reads, independent cursors, completion, EOF and bounds passed.");return 0;
}
