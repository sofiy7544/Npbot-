/* ============================================================
   Stanley Brand UA — AI-консультант (self-contained widget)
   Джерело відповідей: реальна база менеджера (_ASSETS/ai_faq.json),
   санітизована — БЕЗ реквізитів ФОП/IBAN (їх даємо лише при оформленні
   замовлення через Telegram).
   Drop-in: <script src="assets/ai-consultant.js" defer></script>
   ============================================================ */
(function () {
  "use strict";
  if (window.__stanleyAI) return;            // не дублювати
  window.__stanleyAI = true;

  var TG = "https://t.me/stanley_brand_ua";
  var IG = "https://www.instagram.com/stanley_brand_ua/";

  /* ---------- Санітизована база знань ---------- */
  var KB = {
    persona: { tone: "теплий, дружній, на «ви», з доречними емодзі" },
    products: [
      { n: "Quencher H2.0 FlowState 40oz (1.18 л)", p: "2200 грн", opt: "опт від 10 шт — 2000 грн/шт", note: "найпопулярніша, велика наявність" },
      { n: "Герметична модель (887 мл)", p: "2999 грн" },
      { n: "Класична модель (887 мл)", p: "1999 грн" },
      { n: "Лімітована (710 / 590 мл)", p: "2499 грн" },
      { n: "Аксесуари / соломки", p: "від 200 грн" }
    ],
    order_fields: ["ПІБ", "Місто", "Відділення Нової Пошти №", "Номер телефону"]
  };

  /* ---------- Інтенти: keywords -> відповідь (реальні відповіді менеджера) ---------- */
  var INTENTS = [
    { id: "price", kw: ["ціна","цін","скільки кошт","скільки грн","почім","почому","вартість","стоит","стоїть","цена"],
      a: "Актуальні ціни:\n• Quencher 40oz (1.18 л) — <b>2200 грн</b>\n• Герметична 887 мл — <b>2999 грн</b>\n• Класична 887 мл — <b>1999 грн</b>\n• Лімітована 710/590 мл — <b>2499 грн</b>\n• Аксесуари/соломки — від 200 грн\n\nЯка модель вас цікавить? 😊",
      chips: ["Які кольори?","Як замовити?","Опт"] },
    { id: "original", kw: ["оригінал","ориг","підробк","підробка","справжн","фейк","original","оригинал"],
      a: "Так, у нас лише <b>оригінальна продукція Stanley USA</b> 🇺🇸 — працюємо напряму з офіційних джерел, без посередників і підробок.",
      chips: ["Ціна","Гарантія","Як замовити?"] },
    { id: "colors", kw: ["колір","кольор","цвет","розмаїт","палітр","який колір","які кольори","наявн","в наявності","є в наявн"],
      a: "Кольорів і моделей багато 🎨 Актуальну наявність надсилаємо в Telegram — так найшвидше побачите живі фото. Яка модель/об'єм вас цікавить?",
      chips: ["Каталог","Написати в Telegram","Ціна"] },
    { id: "order", kw: ["замов","заказ","як купити","оформ","хочу купити","придбати","купити"],
      a: "Щоб оформити, напишіть, будь ласка:\n• <b>ПІБ</b>\n• <b>Місто</b>\n• <b>Відділення Нової Пошти №</b>\n• <b>Номер телефону</b>\n\nВідправка 1–2 дні 📦 Найзручніше оформити в Telegram 👇",
      chips: ["Написати в Telegram","Оплата","Доставка"] },
    { id: "payment", kw: ["оплат","оплатити","платіж","накладен","наложк","передоплат","реквізит","рахунок","карт","оплата"],
      a: "Два способи оплати:\n1) <b>Накладений платіж</b> із передоплатою 200 грн (комісія НП 20 грн + 2%)\n2) <b>Повна оплата на рахунок ФОП</b> без комісії\n\nРеквізити надамо при оформленні замовлення. Який спосіб зручніший?",
      chips: ["Написати в Telegram","Як замовити?"] },
    { id: "delivery", kw: ["доставк","достав","відправк","нова пошта","новою пошт","скільки йде","коли прийде","термін достав","доставка"],
      a: "Доставляємо <b>Новою Поштою</b> по всій Україні, відправка 1–2 дні після підтвердження. Доставку оплачує покупець за тарифами НП. 🚚",
      chips: ["Як замовити?","Оплата"] },
    { id: "thermo", kw: ["тепло","холод","температур","тримає","скільки годин","гріє","охолодж"],
      a: "Тримає <b>тепло до 8 годин</b> і <b>холод до 30 годин</b> завдяки вакуумній двостінній ізоляції ❄️🔥",
      chips: ["Ціна","Як замовити?"] },
    { id: "warranty", kw: ["гарант","гарантія","брак","дефект","якщо зламаєт","warranty"],
      a: "Ми реселлери, тож власної гарантії не надаємо, але діє <b>офіційна довічна гарантія Stanley</b> на виробничі дефекти. Якщо брак одразу при отриманні — без проблем замінимо. 🤝",
      chips: ["Оригінал","Повернення"] },
    { id: "wholesale", kw: ["опт","оптов","гурт","корпоратив","багато шт","юрособ","фоп рахунок","опт від"],
      a: "Так, працюємо оптом! Від <b>10 шт</b> — ціна <b>2000 грн/шт</b> на модель 1.18 л. Передоплата опту 10% на рахунок ФОП, термін виконання 14–20 днів. Яка кількість потрібна?",
      chips: ["Написати в Telegram","Ціна"] },
    { id: "preorder", kw: ["зі сша","з сша","під замовлення","привезти","із штатів","з європи","з єс","preorder"],
      a: "Так, возимо під замовлення зі США та ЄС 🇺🇸 Передоплата 50%, термін ≈14 робочих днів (до 30 через митницю). Передоплата не повертається, бо товар замовляється індивідуально під вас.",
      chips: ["Написати в Telegram","Наявність зараз"] },
    { id: "returns", kw: ["поверн","обмін","обміняти","повернути","відмов","повернення"],
      a: "У разі <b>браку — замінюємо</b>. Повернення коштів — за номером картки, протягом 7–14 робочих днів. 💳",
      chips: ["Гарантія","Написати в Telegram"] },
    { id: "hello", kw: ["привіт","добрий","вітаю","доброго","hi","hello","здрastv","ку "],
      a: "Вітаю! 👋 Я консультант Stanley Brand UA. Допоможу з вибором моделі, кольору, ціною та оформленням. Що вас цікавить?",
      chips: ["Ціна","Які кольори?","Як замовити?","Опт"] }
  ];

  var FALLBACK = {
    a: "Гарне питання! Найшвидше і найточніше відповімо в Telegram — там же надішлемо живі фото наявних кольорів 💬",
    chips: ["Написати в Telegram","Ціна","Як замовити?"]
  };

  var CHIP_TO_TEXT = { // текст чіпа -> яке питання «ставить» користувач
    "Ціна": "Скільки коштує?", "Які кольори?": "Які кольори в наявності?",
    "Наявність зараз": "Які кольори в наявності?",
    "Як замовити?": "Як замовити?", "Оплата": "Як можна оплатити?",
    "Доставка": "Скільки йде доставка?", "Опт": "Можна оптом?",
    "Гарантія": "Є гарантія?", "Оригінал": "Це оригінал?",
    "Повернення": "Можна повернути або обміняти?"
  };

  function norm(s){ return (s||"").toLowerCase().replace(/[’'`]/g,"").replace(/[^a-zа-яіїєґ0-9\s]/gi," "); }
  function match(text){
    var t = norm(text), best = null, score = 0;
    for (var i=0;i<INTENTS.length;i++){
      var s=0, kws=INTENTS[i].kw;
      for (var j=0;j<kws.length;j++){ if (t.indexOf(norm(kws[j]).trim())>-1) s++; }
      if (s>score){ score=s; best=INTENTS[i]; }
    }
    return score>0 ? best : FALLBACK;
  }

  /* ---------- UI ---------- */
  var CSS = ""
  + ".sai-fab{position:fixed;left:20px;bottom:20px;z-index:9998;width:60px;height:60px;border:none;border-radius:50%;"
  + "background:#13251B;color:#F6F3EB;cursor:pointer;box-shadow:0 10px 30px rgba(19,37,27,.35);display:grid;place-items:center;"
  + "transition:transform .2s ease,box-shadow .2s ease}"
  + ".sai-fab:hover{transform:translateY(-2px) scale(1.04)}"
  + ".sai-fab svg{width:26px;height:26px}"
  + ".sai-badge{position:absolute;top:-3px;right:-3px;width:16px;height:16px;border-radius:50%;background:#C15B3C;border:2px solid #F6F3EB}"
  + ".sai-panel{position:fixed;left:20px;bottom:92px;z-index:9999;width:min(370px,calc(100vw - 40px));height:min(560px,calc(100vh - 130px));"
  + "background:#F6F3EB;border-radius:20px;box-shadow:0 24px 70px rgba(19,37,27,.4);display:flex;flex-direction:column;overflow:hidden;"
  + "opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .25s ease,transform .25s ease;font-family:inherit}"
  + ".sai-panel.open{opacity:1;transform:none;pointer-events:auto}"
  + ".sai-head{background:#13251B;color:#F6F3EB;padding:14px 16px;display:flex;align-items:center;gap:11px}"
  + ".sai-ava{width:38px;height:38px;border-radius:50%;background:#C15B3C;display:grid;place-items:center;font-weight:800;flex:none}"
  + ".sai-head h4{margin:0;font-size:15px;font-weight:700;line-height:1.15}"
  + ".sai-head p{margin:2px 0 0;font-size:11px;opacity:.75;display:flex;align-items:center;gap:5px}"
  + ".sai-dot{width:7px;height:7px;border-radius:50%;background:#5fd08a;display:inline-block}"
  + ".sai-x{margin-left:auto;background:none;border:none;color:#F6F3EB;opacity:.8;cursor:pointer;font-size:20px;line-height:1;padding:4px}"
  + ".sai-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#F6F3EB}"
  + ".sai-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-line;word-wrap:break-word}"
  + ".sai-bot{align-self:flex-start;background:#fff;color:#2A2A2A;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(19,37,27,.06)}"
  + ".sai-user{align-self:flex-end;background:#13251B;color:#F6F3EB;border-bottom-right-radius:4px}"
  + ".sai-bot b{color:#13251B}"
  + ".sai-chips{display:flex;flex-wrap:wrap;gap:7px;padding:2px 2px 0}"
  + ".sai-chip{background:#fff;border:1px solid #e3ddcd;color:#13251B;border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s}"
  + ".sai-chip:hover{background:#efe9da}"
  + ".sai-chip.sai-tg{background:#13251B;color:#F6F3EB;border-color:#13251B}"
  + ".sai-foot{border-top:1px solid #e6dfce;padding:10px;display:flex;gap:8px;background:#F6F3EB}"
  + ".sai-in{flex:1;border:1px solid #e0d9c7;border-radius:12px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;background:#fff;color:#2A2A2A}"
  + ".sai-in:focus{border-color:#13251B}"
  + ".sai-send{background:#C15B3C;border:none;color:#fff;border-radius:12px;width:42px;flex:none;cursor:pointer;display:grid;place-items:center}"
  + ".sai-send svg{width:18px;height:18px}"
  + "@media(max-width:520px){.sai-fab{width:54px;height:54px;left:14px;bottom:74px}.sai-panel{left:10px;right:10px;width:auto;bottom:74px;height:min(70vh,540px)}}";

  var launcher = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>';

  function el(html){ var d=document.createElement("div"); d.innerHTML=html.trim(); return d.firstChild; }

  function mount(){
    var style=document.createElement("style"); style.textContent=CSS; document.head.appendChild(style);

    var fab=el('<button class="sai-fab" aria-label="Консультант Stanley">'+launcher+'<span class="sai-badge"></span></button>');
    var panel=el(
      '<div class="sai-panel" role="dialog" aria-label="AI-консультант Stanley Brand UA">'
      + '<div class="sai-head"><div class="sai-ava">S</div>'
      +   '<div><h4>Консультант Stanley</h4><p><span class="sai-dot"></span>Зазвичай відповідає одразу</p></div>'
      +   '<button class="sai-x" aria-label="Закрити">×</button></div>'
      + '<div class="sai-body" id="saiBody"></div>'
      + '<div class="sai-foot"><input class="sai-in" id="saiIn" placeholder="Напишіть питання…" autocomplete="off">'
      +   '<button class="sai-send" id="saiSend" aria-label="Надіслати"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button></div>'
      + '</div>');
    document.body.appendChild(fab); document.body.appendChild(panel);

    var body=panel.querySelector("#saiBody"), input=panel.querySelector("#saiIn");
    var opened=false, greeted=false;

    function scroll(){ body.scrollTop=body.scrollHeight; }
    function addMsg(text, who){
      var m=el('<div class="sai-msg '+(who==="user"?"sai-user":"sai-bot")+'"></div>');
      m.innerHTML = who==="user" ? escapeHtml(text) : text;
      body.appendChild(m); scroll();
    }
    function escapeHtml(s){ return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }

    function addChips(chips){
      if(!chips||!chips.length) return;
      var wrap=el('<div class="sai-chips"></div>');
      chips.forEach(function(c){
        var isTg = /telegram/i.test(c);
        var chip=el('<button class="sai-chip'+(isTg?" sai-tg":"")+'"></button>');
        chip.textContent = c;
        chip.addEventListener("click",function(){
          if(isTg){ window.open(TG,"_blank","noopener"); return; }
          if(c==="Каталог"){ window.location.href="catalog.html"; return; }
          send(CHIP_TO_TEXT[c] || c);
        });
        wrap.appendChild(chip);
      });
      body.appendChild(wrap); scroll();
    }

    function botReply(userText){
      var r=match(userText);
      setTimeout(function(){
        addMsg(r.a,"bot");
        var chips=(r.chips||[]).slice();
        // завжди даємо шлях у Telegram, якщо його ще немає в чіпах
        if(!chips.some(function(c){return /telegram/i.test(c);})) chips.push("Написати в Telegram");
        addChips(chips);
      }, 260);
    }

    function send(text){
      text=(text||"").trim(); if(!text) return;
      addMsg(text,"user"); input.value="";
      botReply(text);
    }

    function greet(){
      if(greeted) return; greeted=true;
      addMsg("Вітаю! 👋 Я консультант <b>Stanley Brand UA</b>. Допоможу обрати модель і колір, підкажу ціну, доставку та оформлення. Що вас цікавить?","bot");
      addChips(["Ціна","Які кольори?","Як замовити?","Опт","Оплата"]);
    }
    function toggle(){
      opened=!opened; panel.classList.toggle("open",opened);
      fab.querySelector(".sai-badge").style.display = opened ? "none" : "";
      if(opened){ greet(); setTimeout(function(){input.focus();},260); }
    }

    fab.addEventListener("click",toggle);
    panel.querySelector(".sai-x").addEventListener("click",toggle);
    panel.querySelector("#saiSend").addEventListener("click",function(){send(input.value);});
    input.addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); send(input.value);} });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",mount);
  else mount();
})();
