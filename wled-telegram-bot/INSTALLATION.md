# INSTALLATION — INTELLECT 2.0

## Windows (одна кнопка)
1. Распаковать архив.
2. Двойной клик `START.bat` — сам поставит Python и зависимости, при первом
   запуске оптимизирует ПК (с правами), запустит бота и веб-панель.
3. В Telegram боту: `/start`.

## Конфигурация (.env)
```
WLED_BOT_TOKEN=...        # токен @BotFather
ALLOWED_USERS=6194446543  # твой Telegram ID
WLED_IP=192.168.1.106     # IP лампы (бот находит сам — /find)
OPENAI_API_KEY=sk-...     # для AI/голоса/памяти (облако)
AI_MODEL_FAST=gpt-4o-mini
AI_MODEL_STRONG=gpt-4o
WEB_PORT=8080             # старый пульт
INTELLECT_WEB_PORT=8090   # новая панель
ACCESS_PASSWORD=5750      # пароль веб-панели
SAMSUNG_TV_IP=            # опционально
```

## Вручную
```
pip install -r requirements.txt
python wled_bot.py
```

## Тесты
```
python tests/run_all.py     # 102 проверки
```
