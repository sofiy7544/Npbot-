"""
bot.py — Telegram-бот «умная лампа с интеллектом».

Пишешь лампе обычным языком -> GPT понимает -> лампа выполняет и отвечает
от своего лица. Плюс кнопки быстрых действий и картинка текущего света.

Запуск:  python bot.py   (нужен .env с TG_BOT_TOKEN; OPENAI_API_KEY — опционально)
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import (
    Message, CallbackQuery, FSInputFile,
    InlineKeyboardMarkup, InlineKeyboardButton,
)

load_dotenv()

from lamp import LampController          # noqa: E402
from brain import interpret              # noqa: E402
from render import render_lamp           # noqa: E402

TOKEN = os.getenv("TG_BOT_TOKEN", "").strip()
if not TOKEN:
    raise SystemExit("Не задан TG_BOT_TOKEN в .env")

# Ограничение доступа: пусто = любой. Иначе список Telegram user_id через запятую.
_allow = os.getenv("ALLOWED_USERS", "").strip()
ALLOWED = {int(x) for x in _allow.replace(" ", "").split(",") if x} if _allow else None

bot = Bot(token=TOKEN)
dp = Dispatcher()
controller = LampController()

RENDER_DIR = Path(tempfile.gettempdir()) / "smart_lamp"
RENDER_DIR.mkdir(exist_ok=True)


def quick_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardButton
    return InlineKeyboardMarkup(inline_keyboard=[
        [b(text="🔘 Вкл/Выкл", callback_data="power_toggle"),
         b(text="☀️ Ярче", callback_data="bri:+20"),
         b(text="🌙 Тусклее", callback_data="bri:-20")],
        [b(text="🔥 Теплее", callback_data="temp:-600"),
         b(text="❄️ Холоднее", callback_data="temp:+600")],
        [b(text="🍷 Вечер", callback_data="scene:вечер"),
         b(text="🎬 Кино", callback_data="scene:кино"),
         b(text="🎉 Вечеринка", callback_data="scene:вечеринка")],
    ])


def _allowed(uid: int) -> bool:
    return ALLOWED is None or uid in ALLOWED


async def send_state(chat_id: int, caption: str):
    """Отрисовать лампу и отправить фото с подписью и кнопками."""
    path = render_lamp(controller.state, RENDER_DIR / f"{chat_id}.png")
    kb = quick_kb()
    if path:
        await bot.send_photo(chat_id, FSInputFile(path), caption=caption, reply_markup=kb)
    else:
        await bot.send_message(chat_id, f"{caption}\n\nСейчас: {controller.state.human()}", reply_markup=kb)


@dp.message(Command("start"))
async def cmd_start(msg: Message):
    if not _allowed(msg.from_user.id):
        return
    text = (
        "Привет! Я — твоя лампа, и теперь у меня есть мозги 💡\n\n"
        "Пиши мне обычными словами:\n"
        "• «включись», «выключи свет»\n"
        "• «сделай потусклее и потеплее»\n"
        "• «мне режет глаза» / «что-то мрачно»\n"
        "• «врубай киношный свет», «романтика», «читать»\n"
        "• «стань фиолетовой», «яркость 30%»\n\n"
        "Или жми кнопки ниже 👇"
    )
    await send_state(msg.chat.id, text)


@dp.message(Command("status"))
async def cmd_status(msg: Message):
    if not _allowed(msg.from_user.id):
        return
    await send_state(msg.chat.id, f"Сейчас я: {controller.state.human()}")


@dp.message(Command("help"))
async def cmd_help(msg: Message):
    if not _allowed(msg.from_user.id):
        return
    await msg.answer(
        "Говори человеческим языком — я пойму настроение и переведу в свет.\n"
        "Команды: /start, /status. Остальное — просто текстом."
    )


@dp.callback_query()
async def on_button(cb: CallbackQuery):
    if not _allowed(cb.from_user.id):
        await cb.answer()
        return
    data = cb.data or ""
    action: dict | None = None

    if data == "power_toggle":
        action = {"type": "power_toggle"}
    elif data.startswith("bri:"):
        action = {"type": "brightness_delta", "percent": int(data[4:])}
    elif data.startswith("temp:"):
        action = {"type": "temperature_delta", "kelvin": int(data[5:])}
    elif data.startswith("scene:"):
        action = {"type": "scene", "name": data[6:]}

    if action:
        controller.apply_many([action])
    await cb.answer("готово")
    # обновим картинку новым сообщением (проще и надёжнее, чем редактировать медиа)
    await send_state(cb.message.chat.id, f"💡 {controller.state.human()}")


@dp.message(F.text)
async def on_text(msg: Message):
    if not _allowed(msg.from_user.id):
        return
    await bot.send_chat_action(msg.chat.id, "typing")

    # «мозг» работает синхронно (сеть к OpenAI) — уводим в поток, чтобы не блокировать бота
    result = await asyncio.to_thread(interpret, msg.text, controller.state)
    controller.apply_many(result["actions"])

    reply = result.get("reply") or "готово 💡"
    await send_state(msg.chat.id, reply)


async def main():
    mark = "AI (GPT)" if os.getenv("OPENAI_API_KEY") else "правила (без AI)"
    backend = os.getenv("LAMP_BACKEND", "sim")
    print(f"💡 Smart Lamp Bot запущен. Мозг: {mark}. Драйвер лампы: {backend}.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
