/**
 * Telegram message templates (HTML mode).
 */
import type { OrderDraft } from "./parser.js";
import { isMockMode } from "./np-mock.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const WH_LABEL = {
  branch: "Відділення",
  postomat: "Поштомат",
  courier: "Кур'єр",
};

export function formatPreview(draft: OrderDraft): string {
  const lines: string[] = [];
  lines.push("📋 <b>Перевір замовлення перед створенням ТТН</b>");
  if (isMockMode()) {
    lines.push("🧪 <i>MOCK режим — фейкова ТТН для тесту</i>");
  }
  lines.push("");

  lines.push(`👤 <b>ПІБ:</b> ${draft.recipientName ? escapeHtml(draft.recipientName) : "<i>❓ не знайшов</i>"}`);
  lines.push(`📞 <b>Тел:</b> ${draft.recipientPhone ? `<code>${escapeHtml(draft.recipientPhone)}</code>` : "<i>❓ не знайшов</i>"}`);

  if (draft.warehouseType === "courier") {
    lines.push(`🚚 <b>Доставка:</b> Кур'єр`);
    lines.push(`📍 <b>Адреса:</b> ${draft.cityName ? `${escapeHtml(draft.cityName)}, ` : ""}${draft.courierAddress ? escapeHtml(draft.courierAddress) : "<i>❓</i>"}`);
  } else {
    lines.push(`📦 <b>${WH_LABEL[draft.warehouseType]} №${draft.warehouseNumber ?? "<i>❓</i>"}</b>`);
    lines.push(`📍 <b>Місто:</b> ${draft.cityName ? escapeHtml(draft.cityName) : "<i>❓ не знайшов</i>"}`);
  }

  lines.push(`💰 <b>Сума:</b> ${draft.cost ? `${draft.cost} ₴` : "<i>не вказана (буде 0)</i>"}`);
  lines.push(`⚖ <b>Вага:</b> ${draft.weightKg ?? process.env.NP_DEFAULT_WEIGHT_KG ?? "0.6"} кг`);
  lines.push(`📝 <b>Опис:</b> ${escapeHtml(draft.description ?? process.env.NP_DEFAULT_DESCRIPTION ?? "Посилка")}`);
  // Payment line with explicit COD/Prepaid label + confidence indicator
  const isCod = draft.paymentMethod === "Cash";
  const codLabel = isCod ? "🟢 <b>COD</b> (накладений)" : "🔵 <b>Prepaid</b> (передоплата)";
  const confSuffix = typeof draft.paymentConfidence === "number" && draft.paymentConfidence < 0.3
    ? ` ⚠️ <i>низька впевненість (${draft.paymentConfidence.toFixed(2)})</i>`
    : "";
  lines.push(
    `💳 <b>Тип оплати:</b> ${codLabel}${confSuffix} · оплачує <b>${draft.payerType === "Sender" ? "відправник" : "одержувач"}</b>`,
  );

  if (draft.warnings.length) {
    lines.push("");
    lines.push("⚠️ <b>Зауваження:</b>");
    for (const w of draft.warnings) lines.push(`  • ${escapeHtml(w)}`);
  }

  lines.push("");
  lines.push("<i>Натисни кнопку щоб створити або скасуй.</i>");

  return lines.join("\n");
}

export function formatSuccess(opts: {
  ttn: string;
  cost: number;
  estimatedDelivery: string;
  recipientName: string;
  city: string;
  warehouse: string;
}): string {
  const mock = isMockMode();
  return [
    mock ? `🧪 <b>MOCK ТТН створено</b> <i>(не справжня, для тесту)</i>` : `✅ <b>ТТН створено!</b>`,
    ``,
    `📋 <code>${escapeHtml(opts.ttn)}</code>`,
    `👤 ${escapeHtml(opts.recipientName)}`,
    `📍 ${escapeHtml(opts.city)} · ${escapeHtml(opts.warehouse)}`,
    `💰 Вартість доставки: <b>${opts.cost} ₴</b>`,
    `📅 Очікувана дата: ${escapeHtml(opts.estimatedDelivery)}`,
    ``,
    mock
      ? `<i>Це фейк-ТТН. Реальний номер створиться коли налаштуєш NP_API_KEY у .env</i>`
      : `<a href="https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(opts.ttn)}">🔗 Трекінг НП</a>`,
  ].join("\n");
}

export function formatError(error: string): string {
  return `❌ <b>Помилка створення ТТН</b>\n\n<code>${escapeHtml(error)}</code>\n\n<i>Перевір налаштування (.env) або текст замовлення.</i>`;
}
