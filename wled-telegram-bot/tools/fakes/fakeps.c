#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include <windows.h>
/* Фейковый powershell.exe: пишет переменную INTELLECT_BAT (в UTF-8) в ps_env.txt
   в текущей папке и выходит с кодом FAKEPS_RC (по умолчанию 0). */
int main(void) {
    wchar_t buf[4096]; DWORD n = GetEnvironmentVariableW(L"INTELLECT_BAT", buf, 4096);
    char out[16384]; int m = WideCharToMultiByte(CP_UTF8, 0, buf, (int)n, out, sizeof(out), NULL, NULL);
    FILE *f = fopen("ps_env.txt", "wb"); if (f) { fwrite(out, 1, m, f); fclose(f); }
    const char *rc = getenv("FAKEPS_RC");
    return rc ? atoi(rc) : 0;
}
