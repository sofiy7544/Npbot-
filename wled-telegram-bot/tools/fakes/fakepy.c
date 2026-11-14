#include <stdio.h>
#include <stdlib.h>
#include <string.h>
/* Фейковый py.exe: печатает аргументы.
   FAILPIP=1  → падает на "pip install -r".
   FAKEBOT_RC=N → для wled_bot.py возвращает код N. */
int main(int argc, char **argv) {
    printf("FAKE-PY");
    int has_r = 0, is_bot = 0;
    for (int i = 1; i < argc; i++) {
        printf(" %s", argv[i]);
        if (!strcmp(argv[i], "-r")) has_r = 1;
        if (strstr(argv[i], "wled_bot.py")) is_bot = 1;
    }
    printf("\n"); fflush(stdout);
    const char *f = getenv("FAILPIP");
    if (f && !strcmp(f, "1") && has_r) { fprintf(stderr, "ERROR: fake pip failure\n"); return 1; }
    const char *rc = getenv("FAKEBOT_RC");
    if (is_bot && rc) return atoi(rc);
    return 0;
}
