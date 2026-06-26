/**
 * Pure formatting functions for Telegram messages.
 * No side effects, no state — easy to unit-test.
 */
import { isMockMode } from "../../infrastructure/nova-poshta/np-mock.js";
import type { OrderDraft } from "../../infrastructure/parser/parser.js";

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ICON: Record<string, string> = { ok: "✅", missing: "❌", guessed: "⚠️" };

export function renderPreview(d: OrderDraft, isReady: boolean): string {
  const lines: string[] = [];
  lines.push(isMockMode() ? "🧪 <b>MOCK режим</b> — тест без реальної НП\n" : "");
  lines.push(`<b>📋 Замовлення</b>`);
  lines.push(`${ICON[d.fieldStatus.name ?? "missing"]} <b>ПІБ:</b> ${d.recipientName ? escape(d.recipientName) : "<i>—</i>"}`);
  lines.push(`${ICON[d.fieldStatus.phone ?? "missing"]} <b>Тел:</b> ${d.recipientPhone ? `<code>${escape(d.recipientPhone)}</code>` : "<i>—</i>"}`);
  lines.push(`${ICON[d.fieldStatus.city ?? "missing"]} <b>Місто:</b> ${d.cityName ? escape(d.cityName) : "<i>—</i>"}`);
  const whLabel = d.warehouseType === "courier" ? `Кур'єр: ${escape(d.courierAddress ?? "—")}` :
    `${d.warehouseType === "postomat" ? "Поштомат" : "Відділення"} ${d.warehouseNumber ? `№${escape(d.warehouseNumber)}` : ""}`;
  lines.push(`${ICON[d.fieldStatus.warehouse ?? "missing"]} <b>Доставка:</b> ${whLabel}`);
  if (d.cost) lines.push(`💰 <b>Сума:</b> ${d.cost} ₴`);
  if (d.description) lines.push(`📦 <b>Опис:</b> ${escape(d.description)}`);
  lines.push(`💳 <b>Оплата:</b> ${d.paymentMethod === "Cash" ? "Накладений (готівка)" : "Безготівково"} · платить ${d.payerType === "Recipient" ? "отримувач" : "відправник"}`);

  if (d.warnings.length > 0) {
    lines.push(`\n⚠️ <i>${d.warnings.map(escape).join(", ")}</i>`);
  }

  if (!isReady) {
    lines.push(`\n<i>Дозаповни відсутні поля у новому повідомленні — я перепарсю.</i>`);
  }
  return lines.filter(Boolean).join("\n");
}

export function renderSuccess(o: {
  ttn: string;
  cost: number;
  estimatedDelivery: Date | null;
  recipientName: string;
  city: string;
  warehouse: string;
}): string {
  const mock = isMockMode() ? "\n\n🧪 <i>MOCK режим — це фейковий ТТН для тесту</i>" : "";
  const eta = o.estimatedDelivery
    ? o.estimatedDelivery.toLocaleDateString("uk-UA", { day: "2-digit", month: "long" })
    : "—";
  return `✅ <b>ТТН створено</b>

📦 <code>${o.ttn}</code>
👤 ${escape(o.recipientName)}
📍 ${escape(o.city)} · ${escape(o.warehouse)}
💰 ${o.cost} ₴ за доставку
🗓 Прибуття: ${eta}${mock}

<a href="https://novaposhta.ua/tracking/?cargo_number=${o.ttn}">🔗 Відстежити</a>`;
}

export function renderError(msg: string): string {
  return `❌ <b>Не вдалося створити ТТН</b>\n\n<i>${escape(msg)}</i>\n\nВиправ дані і надішли повідомлення ще раз.`;
}

export function renderStart(): string {
  return `👋 <b>Привіт!</b>

Я приймаю замовлення в Telegram і створюю ТТН Нової Пошти.

<b>Приклад:</b>
<code>Іванова Олена Петрівна
+380501234567
Київ, № 42
Сума: 2500
Quencher 40oz Cream
Накладений</code>

<b>Команди:</b>
/help — підтримувані поля
/test — перевірити NP API
/whoami — ID цього чату`;
}

export function renderHelp(): string {
  return `<b>Підтримувані формати замовлень</b>

📝 <b>Поля</b> (у будь-якому порядку, на окремих рядках або через коми):
• <b>ПІБ</b> — кирилицею, 2-3 слова
• <b>Телефон</b> — будь-який формат (+380, 0XX, з дужками, дефісами)
• <b>Місто</b> — Київ, Львів, Дніпро… або латиницею (Kyiv, Lviv)
• <b>Відділення</b> — «№ 42», «НП 42», «відділення 42», «42 НП»
• <b>Поштомат</b> — «поштомат 5», «Паштомат 5», «Почтомат 5»
• <b>Кур'єр</b> — «кур'єр» + адреса
• <b>Сума</b> — «2500», «2500 ₴», «наложка 2500», «опл 2500»

🤖 Бот сам розпізнає:
• Опечатки («НАДОЖКА» → «НАЛОЖКА», «Паштомат» → «Поштомат»)
• Префікси («Відправка на ім'я <i>ПІБ</i>», «Отримувач: <i>ПІБ</i>»)
• Емодзі-розмітку (📦 👤 📱 🏙 🏤 💰)
• Описи товару (не плутає з ПІБ)`;
}
