# Reference projects — TG-bot ↔ Nova Poshta TTN

Свежий ресёрч (май 2026) по 5 проектам с похожей задачей. Цель — сверить нашу
архитектуру с лучшими практиками и подтвердить корректность нашего `np-client.ts`.

---

## 1. lis-dev/nova-poshta-api-2 (PHP, 250+ ⭐)

**Repo:** https://github.com/lis-dev/nova-poshta-api-2

Самый звёздный PHP SDK для НП. Используется как эталон полей `InternetDocument.save`.
В тестах (`tests/NovaPoshtaApi2Test.php`) есть готовая `testNewInternetDocument`
с реальной структурой:

```php
// Sender
'LastName' => $sender['LastName'],
'FirstName' => $sender['FirstName'],
'MiddleName' => $sender['MiddleName'],
'City' => 'Киев',
'Region' => 'Киевская',
'Warehouse' => 'Отделение №1: ул. Пироговский путь, 135',

// Recipient
'FirstName' => 'Сидор',
'MiddleName' => 'Сидорович',
'LastName' => 'Сиродов',
'Phone' => '0509998877',
'City' => 'Киев',
'Region' => 'Киевская',
'Warehouse' => 'Отделение №3: ул. Калачевская, 13',

// Document
'DateTime' => date('d.m.Y', time() + 4 * 84600),
'ServiceType' => 'WarehouseWarehouse',
'PaymentMethod' => 'Cash',
'PayerType' => 'Recipient',
'Cost' => '500',
'SeatsAmount' => '1',
'Description' => 'Спутник',
'CargoType' => 'Cargo',
'Weight' => '10',
'VolumeGeneral' => '0.5',
```

**Урок для нас:**
- `VolumeGeneral` обязательное поле для CargoType=Cargo. Мы сейчас не передаём → можно добавить дефолт `"0.0004"` (термокухоль ~ 8×8×18 см).
- `CargoType` = `Cargo` чаще встречается, чем `Parcel`. Наш дефолт `"Parcel"` — допустимый, но `Cargo` универсальнее.
- `Weight` в кг как строка (`"10"` = 10 кг). Наш `String(weight)` — ОК.

---

## 2. platx/go-nova-poshta (Go, типизированный SDK)

**Pkg:** https://pkg.go.dev/github.com/platx/go-nova-poshta/api/internetdocument

Лучшее место чтобы увидеть полную структуру запроса как типы:

```go
type SaveReq struct {
    SenderWarehouseIndex    *string
    RecipientWarehouseIndex *string
    VolumeGeneral           *float64
    PayerType               enum.PayerType
    PaymentMethod           enum.PaymentMethod
    DateTime                types.CustomDate
    CargoType               enum.CargoType
    Weight                  float64
    ServiceType             enum.ServiceType
    SeatsAmount             int
    Description             string
    Cost                    int
    CitySender              types.UUID
    Sender                  types.UUID
    SenderAddress           types.UUID
    ContactSender           types.UUID
    SendersPhone            string
    CityRecipient           types.UUID
    Recipient               types.UUID
    RecipientAddress        types.UUID
    ContactRecipient        types.UUID
    RecipientsPhone         string
}
```

**Урок для нас:**
- Все Ref-поля это UUID-строки. Так и в нашем коде.
- `Recipient` (counterparty UUID) — обязательный для существующего контрагента. Если используем `NewAddress: 1` (создание на лету для одноразовой физ. отправки), это поле не нужно — НП создаёт контрагента сама.
- Поля типа `SenderWarehouseIndex` это **номер отделения** (например, `"42"`) а не UUID — альтернатива `SenderAddress` (UUID).

---

## 3. xsubject/novaposhtajs (TypeScript SDK)

**Repo:** https://github.com/xsubject/novaposhtajs

Современный TS SDK с promise-based API. Архитектура очень похожа на наш `np-client.ts`:

```js
novaPoshta.address.getCities({ page: 1, limit: 10 })
  .then(cities => console.log(cities))
```

**Урок для нас:**
- Naming по модели: `address.getCities`, `internetDocument.save`. Наш плоский `findCity` / `createTtn` короче, но менее гибкий. Для бота — ОК.
- Тип ответа `{ success, data[], errors[], warnings[] }` — стандарт НП, у нас совпадает.

---

## 4. maddsua/NovaPoshtaREST (TypeScript, ESM)

**Repo:** https://github.com/maddsua/NovaPoshtaREST

Покрывает все методы InternetDocument:
- ✅ save
- ✅ update
- ✅ delete
- ✅ getDocumentList
- ✅ getDocumentPrice
- ✅ getDocumentDeliveryDate
- ✅ generateReport

```typescript
import { getStatusDocuments } from 'novaposhtarest/TrackingDocument';
const { success, data, errors } = await getStatusDocuments(token, {
  Documents: [{ DocumentNumber: '20000000000000', Phone: '+380960000000' }]
});
```

**Урок для нас:**
- `getStatusDocuments` крутая фича — после создания ТТН можно подписаться и постить апдейты в чат («Прибуло у відділення»). Это **next step** для нашего бота.
- `getDocumentPrice` позволяет показать вартість доставки **до** создания ТТН (превью).

---

## 5. Nikitatsivinsky/Telegram-Bot (Python/Flask)

**Repo:** https://github.com/Nikitatsivinsky/Telegram-Bot

Реальный shop-bot с интеграцией НП. Стек: Python + Flask + PostgreSQL + SQLAlchemy + ngrok webhook.

Конфиг:
- `NOVA_POSHTA_API_KEY`
- `COMPANY_TELEPHONE` (для метода `getStatusDocuments`)

**Урок для нас:**
- Они хранят `telegram_id` юзера в БД при первом контакте. У нас сейчас in-memory `state.ts` — это ОК для одноразовой драфт-сессии, но если хотим **историю заказов / повторных клиентов** — нужна БД (SQLite/Postgres).
- Webhook через ngrok vs наш long-polling: long-polling проще, не нужно туннели. Webhook нужен только на проде если хотим под 1000+ req/s.

---

## 🎯 Бонус: Реальная freelance-вакансия (июнь 2025)

**Источник:** Freelancehunt — "Telegram bot for parsing client data and interacting with Nova Poshta API"

Краткий бриф вакансии **точно как у нас**:
> Бот, который парсит из сообщения: прізвище, ім'я, телефон, місто, № відділення/поштомата → возвращает PDF файл ТТН.

**Что мы делаем точно так же:**
- Парсинг имени/телефона/города/№ отделения ✅
- Создание ТТН через `InternetDocument.save` ✅
- Возврат номера ТТН в чат ✅

**Чего у нас ещё нет (next steps):**
- ⏳ PDF файл ТТН — метод `InternetDocumentMarkings.printMarking100x100` отдаёт PDF, можно отдавать в чат как документ
- ⏳ Печать на термопринтере — формат 100×100мм для термоэтикеток
- ⏳ Сохранение ТТН в БД для повторного скачивания

---

## ✅ Сверка нашего `np-client.ts` с эталоном

| Поле | Канон (PHP/Go) | Наш код | Статус |
|---|---|---|---|
| `PayerType` | `Sender`/`Recipient` | ✅ | OK |
| `PaymentMethod` | `Cash`/`NonCash` | ✅ | OK |
| `DateTime` | `d.m.Y` (UA локаль) | ✅ `toLocaleDateString("uk-UA")` | OK |
| `CargoType` | `Cargo` / `Parcel` / `Documents` | ⚠️ `"Parcel"` | **поменять на `"Cargo"`** (универсальнее) |
| `Weight` | string кг | ✅ | OK |
| `ServiceType` | `WarehouseWarehouse` etc | ✅ | OK |
| `SeatsAmount` | `"1"` | ✅ | OK |
| `Description` | string ≤ 100 | ✅ slice(0, 100) | OK |
| `Cost` | string UAH | ✅ | OK |
| `CitySender` / `Sender` / `SenderAddress` / `ContactSender` / `SendersPhone` | UUIDs | ✅ из .env | OK |
| `CityRecipient` / `RecipientAddress` / `RecipientsPhone` | UUIDs | ✅ | OK |
| `VolumeGeneral` | float m³ | ❌ **отсутствует** | **добавить дефолт `0.0004`** |
| `NewAddress: 1` + `RecipientName` + `LastName` + `RecipientType` | для one-off физ. отправки | ✅ | OK |

**Итого:** наш клиент покрывает 90% эталона. Два мелких улучшения:
1. `CargoType` → `Cargo` (вместо `Parcel`)
2. Добавить `VolumeGeneral: "0.0004"` дефолт

---

## Источники

- [lis-dev/nova-poshta-api-2 (PHP SDK)](https://github.com/lis-dev/nova-poshta-api-2)
- [platx/go-nova-poshta (Go SDK)](https://pkg.go.dev/github.com/platx/go-nova-poshta/api/internetdocument)
- [xsubject/novaposhtajs (TS SDK)](https://github.com/xsubject/novaposhtajs)
- [maddsua/NovaPoshtaREST (TS REST)](https://github.com/maddsua/NovaPoshtaREST)
- [Nikitatsivinsky/Telegram-Bot (Python+Flask)](https://github.com/Nikitatsivinsky/Telegram-Bot)
- [Freelancehunt — Telegram bot for parsing client data + NP API](https://freelancehunt.com/en/project/bot-tg-dlya-parseru-dannih-klienta/1522852.html)
- [Nova Poshta API docs (official)](https://developers.novaposhta.ua/documentation)
- [serj1chen/nova-poshta-sdk-php (InternetDocument ApiModel)](https://github.com/serj1chen/nova-poshta-sdk-php/blob/master/lib/NovaPoshta/ApiModels/InternetDocument.php)
