#!/usr/bin/env python3
"""Запуск всех тестов INTELLECT: python tests/run_all.py"""
import subprocess, sys, glob, os
here = os.path.dirname(os.path.abspath(__file__))
ok = fail = 0
for f in sorted(glob.glob(os.path.join(here, "test_*.py"))):
    r = subprocess.run([sys.executable, f], capture_output=True, text=True)
    last = (r.stdout.strip().splitlines() or [""])[-1]
    print(f"{os.path.basename(f):28} {last}")
    import re
    m = re.search(r"(\d+) ok, (\d+) fail", last)
    if m: ok += int(m.group(1)); fail += int(m.group(2))
    else: fail += 1; print(f"   ⚠️ не распарсил вывод:\n{r.stdout}\n{r.stderr}")
print("=" * 50)
print(f"ВСЕГО: {ok} ok, {fail} fail")
sys.exit(1 if fail else 0)
