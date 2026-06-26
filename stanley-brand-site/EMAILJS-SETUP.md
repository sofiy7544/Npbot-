# 📧 EmailJS налаштування (5 хвилин)

## Крок 1: Реєстрація
1. Відкрий https://www.emailjs.com/
2. Sign Up безкоштовно (200 листів/міс)
3. Email Services → Add New Service → Gmail (або Outlook) → авторизуйся

## Крок 2: Створи Templates
В EmailJS Templates → Create New Template. Створи 4 шаблони:

### Template 1: "Order" (замовлення тобі)
```
To Email: {твій бізнес-email}
Subject: 🛍 Нове замовлення {{order_id}}

Замовлення: {{order_id}}
Клієнт: {{customer_name}}
Email: {{customer_email}}
Телефон: {{customer_phone}}
Доставка: {{shipping_method}}
Оплата: {{payment_method}}

Товари:
{{items_summary}}

Сума: {{order_total}} ₴
Дата: {{order_date}}
```

### Template 2: "Welcome" (вітання після 1-ої покупки)
```
To Email: {{to_email}}
Subject: 🎁 Дякуємо за покупку, {{first_name}}!

Привіт, {{first_name}}!

Дякуємо за замовлення {{order_id}}.

🎉 Тобі знижка 50% на наступне замовлення!
Промокод: {{welcome_code}}
(дійсний 30 днів)

stanley_brand_ua
```

### Template 3: "Reset Password"
```
To Email: {{to_email}}
Subject: 🔐 Тимчасовий пароль

Привіт, {{first_name}}!

Твій тимчасовий пароль: {{temp_password}}
Зайди в кабінет і одразу зміни його.

stanley_brand_ua
```

### Template 4: "Cashback" (рефереру)
```
To Email: {{to_email}}
Subject: 💰 Тобі кешбек {{cashback_amount}} ₴

Твій друг ({{friend_email}}) щойно зробив першу покупку!

Тобі нараховано: {{cashback_amount}} ₴
Поточний баланс: {{balance}} ₴
Запрошено друзів: {{invited_count}}

Використай бонуси при наступному замовленні.

stanley_brand_ua
```

## Крок 3: Підключити до сайту
1. Відкрий `admin.html` у браузері
2. Логін (за замовч. пароль — `admin`)
3. Перейди в «Контакти / Brand»
4. Прокрути до **📧 EmailJS · Інтеграція пошти**
5. Скопіюй з emailjs.com:
   - **Public Key** (Account → API Keys)
   - **Service ID** (Email Services → твій сервіс)
   - **Template ID** для кожного з 4 шаблонів
6. Постав значення → **💾 Зберегти EmailJS**
7. Натисни **📨 Надіслати тестовий лист** для перевірки

## Telegram-група для замовлень
Найпростіший шлях:
1. Створи Telegram-канал (твій бізнес)
2. У Make.com (безкоштовно) зроби сценарій:
   - **Trigger:** Gmail → Watch Emails (filter: from EmailJS)
   - **Action:** Telegram Bot → Send Message
3. Все. Замовлення з EmailJS → Gmail → Telegram автоматично

Альтернатива без Make: просто читай email на телефоні з Gmail-додатком.

## Якщо EmailJS не підключено
- Реєстрація працює (зберігає у localStorage)
- Замовлення оформлюються нормально
- Просто **немає email-сповіщень**
- Можна підключити пізніше, не зачіпаючи коду
