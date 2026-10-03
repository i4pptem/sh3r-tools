#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#include <stdio.h>
#include <stdint.h>
HRESULT WINAPI DirectInput8Create(HINSTANCE,DWORD,const GUID*,LPVOID*,LPVOID);
__declspec(dllexport) DWORD TestPatchWords[3] = {0x53483354, 0x50415443, 0x54455354};
int main(int argc,char **argv) {
    (void)argv;
    if(argc<0) DirectInput8Create(NULL,0,NULL,NULL,NULL);
    if(TestPatchWords[0]==0x53483354) {puts("ASI was not initialized before main");return 1;}
    int(__cdecl *code)(void)=(int(__cdecl*)(void))(uintptr_t)TestPatchWords[0];
    if(code()!=90)return 2;
    const WCHAR* paths[]={L"data\\test.bin",L"data\\fallback.bin"};
    for(int i=0;i<2;i++){
        HANDLE file=CreateFileW(paths[i],GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);
        if(file==INVALID_HANDLE_VALUE)return 3;
        char text[20]={0};DWORD count;WCHAR final[1024];
        ReadFile(file,text,19,&count,NULL);GetFinalPathNameByHandleW(file,final,1024,0);CloseHandle(file);
        printf("%ls => %ls: %s\n",paths[i],final,text);
        if(strcmp(text,i?"FALLBACK":"MOD"))return 4;
    }
    WIN32_FILE_ATTRIBUTE_DATA attr;WIN32_FIND_DATAA found;
    if(!GetFileAttributesExW(paths[0],GetFileExInfoStandard,&attr)||attr.nFileSizeLow!=3)return 5;
    HANDLE search=FindFirstFileA("data\\test.bin",&found);if(search==INVALID_HANDLE_VALUE||found.nFileSizeLow!=3)return 6;FindClose(search);
    char audioPath[]="data\\test.bin",text[20]={0};HMMIO audio=mmioOpenA(audioPath,NULL,MMIO_READ);
    if(!audio||mmioRead(audio,text,19)!=3||strcmp(text,"MOD"))return 7;mmioClose(audio,0);
    puts("Real UAL: early ASI initialization, file redirection, vanilla fallback, metadata and mmio all passed.");return 0;
}
