#!/bin/bash
# =============================================================================
# tools/test_bats.sh — проверка .bat-файлов INTELLECT настоящим cmd.exe (Wine).
#
#   tools/test_bats.sh <папка_собранного_пакета>
#
# Пакет должен быть собран tools/build_release.sh (там .bat уже с CRLF).
# Нужно: wine (apt install wine64 | wine), x86_64-w64-mingw32-gcc
# (apt install gcc-mingw-w64-x86-64) — для фейковых py.exe / powershell.exe.
# Рабочая папка: $BATTEST_DIR (по умолчанию /tmp/intellect-battest).
#
# Почему так: ранние архивы уходили со сломанными .bat (скобка в echo внутри
# if-блока, LF вместо CRLF, не-ASCII символы). Wine — не настоящая Windows:
# его powershell — заглушка, поэтому создание ярлыка автозапуска здесь
# проверяется только через фейковый powershell.exe (передача пути).
# =============================================================================
PKG="$(cd "$1" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${BATTEST_DIR:-/tmp/intellect-battest}"
FAKES="$BASE/fakes"
mkdir -p "$FAKES"
[ -f "$FAKES/py.exe" ] || x86_64-w64-mingw32-gcc -O2 -o "$FAKES/py.exe" "$HERE/fakes/fakepy.c" || { echo "нет mingw: apt install gcc-mingw-w64-x86-64"; exit 2; }
[ -f "$FAKES/powershell.exe" ] || x86_64-w64-mingw32-gcc -O2 -o "$FAKES/powershell.exe" "$HERE/fakes/fakeps.c" || exit 2
export WINEDEBUG=-all WINEPREFIX=$BASE/.wine LANG=C.UTF-8 LC_ALL=C.UTF-8
FAIL=0
pass(){ echo "  PASS: $1"; }
fail(){ echo "  FAIL: $1"; FAIL=1; }

# --- статические проверки ---
echo "[static]"
for f in "$PKG"/*.bat; do
  n=$(basename "$f")
  if LC_ALL=C grep -qP '[^\x00-\x7F]' "$f"; then fail "$n: не-ASCII символы"; else pass "$n: ASCII"; fi
  lf=$(grep -c $'[^\r]$' "$f" || true)
  if [ "$lf" -gt 0 ]; then fail "$n: $lf строк без CRLF"; else pass "$n: CRLF"; fi
done


SL(){ tr -d '\r' < "$1/logs/start.log" 2>/dev/null; }
has(){ grep -qF -- "$2" <<<"$(SL "$1")" && pass "start.log: «$2»" || fail "в start.log нет «$2»"; }

run_case(){ # $1=имя, $2=подготовка (bash), $3=env FAILPIP
  local D=$BASE/case_$1
  rm -rf "$D"; mkdir -p "$D"; cp -a "$PKG"/. "$D"/
  # фейковый py: печатает аргументы; при FAILPIP=1 «падает» на pip -r
  cp $FAKES/py.exe "$D/py.exe"
  # фейковые системные утилиты не нужны: всё перенаправлено в nul
  (cd "$D"; eval "$2")
  local W; W=$(winepath -w "$D/START.bat")
  OUT=$(cd "$D"; FAILPIP=$3 FAKEBOT_RC=$4 timeout 25 wine cmd /c "$W" </dev/null 2>&1 | tr -d '\r')
  echo "$OUT" > "$D/_out.txt"
}

echo "[case A: первая установка, .env есть]"
run_case A 'cp .env.example .env; touch .optimized' 0
grep -q "unexpected\|Can't recognize" <<<"$OUT" && fail "ошибка разбора: $(grep -m1 "unexpected\|Can't recognize" <<<"$OUT")" || pass "нет ошибок разбора"
grep -q "Installing libraries" <<<"$OUT" && pass "ставит библиотеки" || fail "не дошёл до установки библиотек"
[ -f $BASE/case_A/.deps_ok ] && pass ".deps_ok создан" || fail ".deps_ok не создан"
grep -q "FAKE-PY find_lamp.py" <<<"$OUT" && pass "запускает find_lamp" || fail "не запустил find_lamp"
grep -q "FAKE-PY wled_bot.py" <<<"$OUT" && pass "запускает бота" || fail "не запустил бота"
grep -q "Restarting in 5 sec" <<<"$OUT" && pass "авто-перезапуск бота работает" || fail "нет авто-перезапуска"


A=$BASE/case_A
for t in "===== START.bat started =====" "Python: py" "Installing libraries - details in logs" "Libraries installed OK" ".env: present" "find_lamp exit code: 0" "Bot starting" "Bot stopped, exit code 0"; do has $A "$t"; done
grep -q 'folder: "' <<<"$(SL $A)" && pass "start.log: путь к папке записан" || fail "нет пути к папке"
grep -qE "Version: [0-9]+\.[0-9]+" <<<"$(SL $A)" && pass "start.log: версия сборки записана" || fail "в start.log нет версии"
grep -qF -- '--log logs\pip.log' <<<"$(cat $A/_out.txt)" && pass "pip пишет подробности в logs\pip.log" || fail "pip без --log"
echo "[case E: бот вернул 2 — плохой токен]"
run_case E 'cp .env.example .env; touch .optimized; echo done> .deps_ok' 0 2
grep -q "Settings problem in .env" <<<"$OUT" && pass "сообщает про ошибку настроек" || fail "нет сообщения про .env"
grep -q "Restarting in 5 sec" <<<"$OUT" && fail "крутит бесконечный перезапуск" || pass "НЕ перезапускает бесконечно"
grep -q "Press any key to close" <<<"$OUT" && pass "окно ждёт клавишу" || fail "нет паузы"
[ "$(grep -c 'FAKE-PY wled_bot.py' <<<"$OUT")" = "1" ] && pass "бот запущен ровно 1 раз" || fail "бот запускался не 1 раз"

has $BASE/case_E "Bot stopped, exit code 2"; has $BASE/case_E "Stop: settings problem in .env"; has $BASE/case_E "END - window waits"
echo "[case F: бот вернул 3 — уже запущен]"
run_case F 'cp .env.example .env; touch .optimized; echo done> .deps_ok' 0 3
grep -q "ALREADY RUNNING" <<<"$OUT" && pass "сообщает «уже запущен»" || fail "нет сообщения «уже запущен»"
grep -q "Restarting in 5 sec" <<<"$OUT" && fail "крутит перезапуск" || pass "НЕ перезапускает"
grep -q "Press any key to close" <<<"$OUT" && pass "окно ждёт клавишу" || fail "нет паузы"

has $BASE/case_F "Bot stopped, exit code 3"; has $BASE/case_F "Stop: another copy of the bot is already running"
echo "[case P0: автозапуск, путь с украинскими буквами, PowerShell ок]"
UD="$BASE/Андрій Робочий стіл/INTELLECT-2.0"
rm -rf "$BASE/Андрій Робочий стіл"; mkdir -p "$UD"; cp -a "$PKG"/. "$UD"/
cp "$FAKES/py.exe" "$FAKES/powershell.exe" "$UD"/
(cd "$UD"; cp .env.example .env; touch .optimized; echo done> .deps_ok)
OUT=$(cd "$UD"; FAKEPS_RC=0 FAKEBOT_RC=3 timeout 25 wine cmd /c "$(winepath -w "$UD/START.bat")" </dev/null 2>&1 | tr -d '\r')
grep -q "unexpected\|Can't recognize" <<<"$OUT" && fail "ошибка разбора: $(grep -m1 "unexpected\|Can't recognize" <<<"$OUT")" || pass "нет ошибок разбора"
GOT=$(cat "$UD/ps_env.txt" 2>/dev/null)
WANT=$(winepath -w "$UD/START.bat")
[ "$GOT" = "$WANT" ] && pass "PowerShell получил путь с «і» без искажений: $GOT" || fail "путь искажён: получил «$GOT», ждали «$WANT»"
grep -q "Autostart with Windows: on - this folder" <<<"$OUT" && pass "сообщает: автозапуск включён" || fail "нет сообщения об автозапуске"
grep -q "FAKE-PY wled_bot.py" <<<"$OUT" && pass "бот запущен" || fail "бот не запущен"

has "$UD" "Autostart: shortcut INTELLECT.lnk in Startup - OK"
echo "[case P1: PowerShell не смог → запасной вариант]"
(cd "$UD"; rm -f ps_env.txt)
OUT=$(cd "$UD"; FAKEPS_RC=1 FAKEBOT_RC=3 timeout 25 wine cmd /c "$(winepath -w "$UD/START.bat")" </dev/null 2>&1 | tr -d '\r')
grep -q "unexpected\|Can't recognize" <<<"$OUT" && fail "ошибка разбора" || pass "нет ошибок разбора"
grep -q "Autostart with Windows: on - this folder" <<<"$OUT" && fail "врёт, что ярлык создан" || pass "не врёт про ярлык"
grep -qE "via Task Scheduler|Could not set up autostart" <<<"$OUT" && pass "запасной путь: $(grep -oE 'via Task Scheduler|Could not set up autostart' <<<"$OUT" | head -1)" || fail "нет запасного пути"
grep -q "FAKE-PY wled_bot.py" <<<"$OUT" && pass "бот всё равно запущен" || fail "бот не запущен"

grep -qE "Autostart: shortcut FAILED|ERROR: autostart FAILED" <<<"$(SL "$UD")" && pass "start.log: провал ярлыка записан" || fail "в start.log нет записи о провале автозапуска"
echo "[case B: повторный запуск, библиотеки уже стоят]"
run_case B 'cp .env.example .env; touch .optimized; echo done> .deps_ok' 0
grep -q "already installed - skipping" <<<"$OUT" && pass "пропускает pip" || fail "не пропустил pip"
grep -q "FAKE-PY -m pip" <<<"$OUT" && fail "зря вызвал pip" || pass "pip не вызывался"
grep -q "FAKE-PY wled_bot.py" <<<"$OUT" && pass "запускает бота" || fail "не запустил бота"

echo "[case C: нет .env]"
run_case C 'touch .optimized; echo done> .deps_ok; rm -f .env' 0
grep -q "Missing .env" <<<"$OUT" && pass "сообщает про .env" || fail "не сообщил про .env"
[ -f $BASE/case_C/.env ] && pass ".env создан из примера" || fail ".env не создан"
grep -q "Press any key to close" <<<"$OUT" && pass "окно ждёт клавишу" || fail "нет паузы в конце"
grep -q "FAKE-PY wled_bot.py" <<<"$OUT" && fail "бот запущен без настроенного .env" || pass "бот не запущен без .env"

has $BASE/case_C "ERROR: .env missing"; has $BASE/case_C "END - window waits"
echo "[case D: pip упал]"
run_case D 'cp .env.example .env; touch .optimized' 1
grep -q "Library install failed" <<<"$OUT" && pass "сообщает об ошибке pip" || fail "молчит об ошибке pip"
[ -f $BASE/case_D/.deps_ok ] && fail ".deps_ok создан при ошибке" || pass ".deps_ok не создан при ошибке"
grep -q "Press any key to close" <<<"$OUT" && pass "окно ждёт клавишу" || fail "нет паузы"

has $BASE/case_D "ERROR: library install failed - see logs"

echo "[case ROT: ротация start.log]"
run_case ROT 'cp .env.example .env; touch .optimized; echo done> .deps_ok; mkdir -p logs; head -c 400000 /dev/zero | tr "\0" "x" > logs/start.log' 0 3
[ -f $BASE/case_ROT/logs/start.log.old ] && pass "большой start.log ушёл в start.log.old" || fail "нет ротации"
sz=$(stat -c %s $BASE/case_ROT/logs/start.log 2>/dev/null || echo 999999)
[ "$sz" -lt 100000 ] && pass "новый start.log маленький ($sz байт)" || fail "start.log не обрезан ($sz)"

echo "[startup_guard.bat]"
D=$BASE/case_G; rm -rf "$D"; mkdir -p "$D"; cp -a "$PKG"/. "$D"/
wine reg add 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v "CCleaner Smart Cleaning" /t REG_SZ /d x /f >/dev/null 2>&1
OUT=$(cd "$D"; timeout 25 wine cmd /c "$(winepath -w "$D/startup_guard.bat")" </dev/null 2>&1 | tr -d '\r')
grep -q "unexpected\|Can't recognize" <<<"$OUT" && fail "ошибка разбора guard: $OUT" || pass "guard без ошибок разбора"
wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run' /v "CCleaner Smart Cleaning" >/dev/null 2>&1 && fail "CCleaner остался в Run" || pass "CCleaner удалён из Run"
wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' /v "CCleaner Smart Cleaning" 2>/dev/null | tr -d '\r' | grep -qi "03000000" && pass "CCleaner помечен disabled" || fail "нет флага disabled"

echo "[остальные .bat: разбор cmd.exe]"
for b in SETUP DIAGNOSTICS REPORT optimize_admin; do
  D=$BASE/other_$b; rm -rf "$D"; mkdir -p "$D"; cp -a "$PKG"/. "$D"/; cp "$FAKES/py.exe" "$D"/; cp "$D/.env.example" "$D/.env"
  OUT=$(cd "$D"; timeout 40 wine cmd /c "$(winepath -w "$D/$b.bat")" </dev/null 2>&1 | tr -d '\r')
  grep -q "unexpected\|Can't recognize" <<<"$OUT" && fail "$b.bat: $(grep -m1 "unexpected\|Can't recognize" <<<"$OUT")" || pass "$b.bat без ошибок разбора"
  [ "$b" = REPORT ] && { grep -qF "FAKE-PY diaglog.py --report" <<<"$OUT" && pass "REPORT.bat собирает отчёт через diaglog.py --report" || fail "REPORT.bat не вызвал diaglog.py --report"; }
done

echo
[ $FAIL -eq 0 ] && echo "ИТОГ: ВСЁ ПРОШЛО" || echo "ИТОГ: ЕСТЬ ОШИБКИ"
exit $FAIL
