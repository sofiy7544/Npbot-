# -*- coding: utf-8 -*-
"""HTML современной мобильной панели INTELLECT (single-page, без зависимостей)."""

CLASSIC_PAGE = r"""<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#07070c">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="manifest" href="/manifest.json">
<title>INTELLECT</title>
<style>
:root{--bg:#07070c;--card:#14141d;--card2:#1b1b27;--line:#28283a;--txt:#f0f0f6;
 --mut:#8e8ea6;--acc:#7c5cff;--acc2:#9d7bff;--ok:#2ecc71;--red:#ff5a5a;--warn:#ffb020;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 color:var(--txt);background:
 radial-gradient(120% 55% at 50% -10%,#1a1330 0,transparent 60%),
 radial-gradient(90% 50% at 100% 110%,#102030 0,transparent 55%),var(--bg);
 padding:max(12px,env(safe-area-inset-top)) 12px calc(84px + env(safe-area-inset-bottom));
 max-width:560px;margin:0 auto;min-height:100vh}
h1{font-size:19px;font-weight:800;margin:6px 4px 14px;display:flex;align-items:center;gap:8px}
.badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:var(--card2);color:var(--mut)}
.badge.on{color:var(--ok)}.badge.off{color:var(--red)}
.card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);
 border-radius:18px;padding:16px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.t{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin:0 0 10px}
.kpi{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.kpi .b{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:12px}
.kpi .v{font-size:20px;font-weight:800}.kpi .l{font-size:12px;color:var(--mut);margin-top:2px}
.dot{width:10px;height:10px;border-radius:50%;background:#666;display:inline-block}
.dot.on{background:var(--ok);box-shadow:0 0 10px var(--ok)}.dot.off{background:#666}
button,.btn{font:inherit;border:0;border-radius:13px;padding:12px 14px;font-weight:700;color:#fff;
 background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 6px 14px rgba(124,92,255,.35)}
.btn.ghost{background:var(--card2);color:var(--txt);border:1px solid var(--line);box-shadow:none}
.btn.sm{padding:8px 12px;font-size:13px;border-radius:11px}
input,textarea{font:inherit;width:100%;background:#0c0c14;border:1px solid var(--line);color:var(--txt);
 border-radius:12px;padding:12px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.list .item{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;
 margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.muted{color:var(--mut);font-size:13px}
.empty{color:var(--mut);text-align:center;padding:24px 10px;font-size:14px}
.err{color:var(--red);text-align:center;padding:18px;font-size:14px}
.spin{width:22px;height:22px;border:3px solid var(--line);border-top-color:var(--acc);
 border-radius:50%;animation:s .8s linear infinite;margin:24px auto}
@keyframes s{to{transform:rotate(360deg)}}
.chat{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding:4px}
.msg{max-width:84%;padding:10px 13px;border-radius:15px;font-size:15px;line-height:1.35;white-space:pre-wrap}
.msg.u{align-self:flex-end;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border-bottom-right-radius:5px}
.msg.a{align-self:flex-start;background:var(--card2);border:1px solid var(--line);border-bottom-left-radius:5px}
.tabbar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:2px;justify-content:space-around;
 background:rgba(12,12,20,.92);backdrop-filter:blur(12px);border-top:1px solid var(--line);
 padding:8px 6px calc(8px + env(safe-area-inset-bottom));max-width:560px;margin:0 auto}
.tab{flex:1;text-align:center;color:var(--mut);font-size:10px;font-weight:700;padding:4px 0}
.tab .i{font-size:19px;display:block}.tab.active{color:var(--acc2)}
.page{display:none}.page.active{display:block;animation:f .25s}
@keyframes f{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.sw{display:flex;gap:7px;flex-wrap:wrap}.sw b{width:34px;height:34px;border-radius:9px;border:1px solid var(--line)}
#login{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;justify-content:center;
 padding:24px;gap:12px;z-index:50}
</style></head><body>

<div id="login">
  <h1 style="justify-content:center">💡 INTELLECT</h1>
  <p class="muted" style="text-align:center">Введи пароль доступа</p>
  <input id="pw" type="password" placeholder="пароль" inputmode="numeric">
  <button onclick="login()">Войти</button>
  <p id="loginErr" class="err" style="display:none">Неверный пароль</p>
</div>

<div id="app" style="display:none">
  <h1>💡 INTELLECT <span id="aiBadge" class="badge">…</span></h1>

  <!-- DASHBOARD -->
  <div class="page active" id="p-dash">
    <div id="dash"><div class="spin"></div></div>
  </div>

  <!-- CHAT -->
  <div class="page" id="p-chat">
    <div class="card"><div class="chat" id="chat"></div></div>
    <div class="row"><input id="chatIn" placeholder="Напиши ассистенту…" onkeydown="if(event.key==='Enter')sendChat()">
      <button onclick="sendChat()">➤</button></div>
  </div>

  <!-- DEVICES -->
  <div class="page" id="p-dev"><div id="dev"><div class="spin"></div></div></div>

  <!-- MEMORY -->
  <div class="page" id="p-mem">
    <div class="card"><p class="t">🧠 Добавить в память</p>
      <div class="row"><input id="memIn" placeholder="Запомнить факт…"><button onclick="addMem()">+</button></div></div>
    <div id="mem"><div class="spin"></div></div>
  </div>

  <!-- AUTOMATIONS -->
  <div class="page" id="p-auto"><div id="auto"><div class="spin"></div></div></div>

  <!-- TASKS -->
  <div class="page" id="p-task">
    <div class="card"><p class="t">📋 Новая задача</p>
      <div class="row"><input id="taskIn" placeholder="Что сделать…"><button onclick="addTask()">+</button></div></div>
    <div id="task"><div class="spin"></div></div>
  </div>

  <!-- SYSTEM -->
  <div class="page" id="p-sys"><div id="sys"><div class="spin"></div></div></div>
</div>

<div class="tabbar" id="tabbar" style="display:none">
  <div class="tab active" data-p="dash" onclick="go('dash')"><span class="i">📊</span>Обзор</div>
  <div class="tab" data-p="chat" onclick="go('chat')"><span class="i">💬</span>Чат</div>
  <div class="tab" data-p="dev" onclick="go('dev')"><span class="i">💡</span>Устройства</div>
  <div class="tab" data-p="mem" onclick="go('mem')"><span class="i">🧠</span>Память</div>
  <div class="tab" data-p="auto" onclick="go('auto')"><span class="i">⚙️</span>Авто</div>
  <div class="tab" data-p="task" onclick="go('task')"><span class="i">📋</span>Задачи</div>
  <div class="tab" data-p="sys" onclick="go('sys')"><span class="i">🖥</span>ПК</div>
</div>

<script>
let TOKEN = localStorage.getItem('intellect_token') || '';
const $=id=>document.getElementById(id);
const esc=s=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function api(path, method='GET', body){
  const o={method,headers:{'X-Intellect-Token':TOKEN}};
  if(body){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
  const r=await fetch('/api'+path,o);
  if(r.status===401){logout();throw new Error('auth')}
  return {status:r.status,data:await r.json().catch(()=>({}))};
}
function login(){TOKEN=$('pw').value.trim();
  fetch('/api/status',{headers:{'X-Intellect-Token':TOKEN}}).then(r=>{
    if(r.status===200){localStorage.setItem('intellect_token',TOKEN);showApp()}
    else{$('loginErr').style.display='block'}
  }).catch(()=>$('loginErr').style.display='block');}
function logout(){localStorage.removeItem('intellect_token');location.reload()}
function showApp(){$('login').style.display='none';$('app').style.display='block';
  $('tabbar').style.display='flex';go('dash')}

function go(p){document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));
  $('p-'+p).classList.add('active');
  document.querySelector('.tab[data-p="'+p+'"]').classList.add('active');
  ({dash:loadDash,dev:loadDev,mem:loadMem,auto:loadAuto,task:loadTask,sys:loadSys}[p]||(()=>{}))();}

function fail(el){ $(el).innerHTML='<div class="err">⚠️ Нет связи с ядром</div>'; }

async function loadDash(){try{
  const {data:s}=await api('/status');
  $('aiBadge').textContent=s.ai.available?'AI вкл':'AI выкл';
  $('aiBadge').className='badge '+(s.ai.available?'on':'off');
  const devs=Object.entries(s.devices||{}).map(([k,d])=>
    `<div class="row" style="margin-top:8px"><span><span class="dot ${d.online?'on':'off'}"></span> ${k}</span>
     <span class="muted">${d.online?(d.on!==undefined?(d.on?'вкл':'выкл'):'онлайн'):'офлайн'}</span></div>`).join('');
  $('dash').innerHTML=`
   <div class="card"><div class="kpi">
     <div class="b"><div class="v">${s.ai.available?'🟢':'⚪️'}</div><div class="l">AI · ${esc(s.ai.model_fast)}</div></div>
     <div class="b"><div class="v">${s.voice.listen?'🎤':'—'}</div><div class="l">Голос ${s.voice.listen?'готов':'выкл'}</div></div>
     <div class="b"><div class="v">${s.automations_active}</div><div class="l">Автоматизаций</div></div>
     <div class="b"><div class="v">${s.tasks_open}</div><div class="l">Задач открыто</div></div>
   </div></div>
   <div class="card"><p class="t">Устройства</p>${devs||'<div class="empty">Нет устройств</div>'}</div>`;
}catch(e){fail('dash')}}

async function loadDev(){try{
  const {data}=await api('/devices');const d=data.devices||{};
  const lamp=d.lamp||{};
  $('dev').innerHTML=`
   <div class="card"><div class="row"><p class="t" style="margin:0">💡 Лампа <span class="dot ${lamp.online?'on':'off'}"></span></p>
     <span class="muted">${lamp.online?lamp.brightness+'%':'офлайн'}</span></div>
     <div class="grid3" style="margin-top:12px">
       <button onclick="dev('lamp',{action:'power',on:true})">Вкл</button>
       <button class="ghost" onclick="dev('lamp',{action:'power',on:false})">Выкл</button>
       <button class="ghost" onclick="dev('lamp',{action:'brightness',percent:100})">100%</button>
     </div>
     <div class="sw" style="margin-top:10px">
       ${[['255,0,0'],['0,180,255'],['0,255,0'],['255,210,0'],['150,0,255'],['255,255,255']].map(c=>
        `<b style="background:rgb(${c[0]})" onclick="dev('lamp',{action:'color',rgb:[${c[0]}]})"></b>`).join('')}
     </div>
   </div>
   <div class="card"><div class="row"><p class="t" style="margin:0">📺 Телевизор <span class="dot ${(d.tv||{}).online?'on':'off'}"></span></p></div>
     <div class="grid3" style="margin-top:12px">
       <button onclick="dev('tv',{action:'power',on:true})">Вкл</button>
       <button class="ghost" onclick="dev('tv',{action:'power',on:false})">Выкл</button>
       <button class="ghost" onclick="dev('tv',{action:'mute'})">🔇</button>
     </div></div>`;
}catch(e){fail('dev')}}
async function dev(k,c){await api('/devices/command','POST',{device:k,command:c});setTimeout(loadDev,400)}

let CHAT=[];
function renderChat(){$('chat').innerHTML=CHAT.map(m=>`<div class="msg ${m.r}">${esc(m.t)}</div>`).join('');
  $('chat').scrollTop=1e9;}
async function sendChat(){const t=$('chatIn').value.trim();if(!t)return;$('chatIn').value='';
  CHAT.push({r:'u',t});renderChat();
  try{const {data}=await api('/chat','POST',{text:t});CHAT.push({r:'a',t:data.reply||'…'});renderChat();}
  catch(e){CHAT.push({r:'a',t:'⚠️ Нет связи'});renderChat();}}

async function loadMem(){try{const {data}=await api('/memory');
  $('mem').innerHTML=data.items.length?('<div class="list">'+data.items.map(i=>
   `<div class="item"><span>${esc(i.content)}</span><button class="ghost sm" onclick="delMem(${i.id})">✕</button></div>`).join('')+'</div>')
   :'<div class="empty">Память пуста. Добавь факт выше или скажи боту «запомни…»</div>';
}catch(e){fail('mem')}}
async function addMem(){const c=$('memIn').value.trim();if(!c)return;$('memIn').value='';
  await api('/memory','POST',{content:c});loadMem();}
async function delMem(id){await api('/memory','DELETE',{id});loadMem();}

async function loadAuto(){try{const {data}=await api('/automations');
  $('auto').innerHTML=data.items.length?('<div class="list">'+data.items.map(a=>
   `<div class="item"><span><b>${esc(a.name)}</b><br><span class="muted">${esc(a.trigger_type)}: ${esc(a.trigger_spec)}</span></span>
    <span><button class="${a.enabled?'':'ghost'} sm" onclick="togAuto(${a.id},${!a.enabled})">${a.enabled?'вкл':'выкл'}</button>
    <button class="ghost sm" onclick="delAuto(${a.id})">✕</button></span></div>`).join('')+'</div>')
   :'<div class="empty">Автоматизаций нет. Скажи боту: «каждый день в 23:00 выключай свет».</div>';
}catch(e){fail('auto')}}
async function togAuto(id,en){await api('/automations/toggle','POST',{id,enabled:en});loadAuto();}
async function delAuto(id){await api('/automations/delete','POST',{id});loadAuto();}

async function loadTask(){try{const {data}=await api('/tasks');
  $('task').innerHTML=data.items.length?('<div class="list">'+data.items.map(t=>
   `<div class="item"><span>${esc(t.title)}</span><button class="sm" onclick="doneTask(${t.id})">✓</button></div>`).join('')+'</div>')
   :'<div class="empty">Задач нет</div>';
}catch(e){fail('task')}}
async function addTask(){const t=$('taskIn').value.trim();if(!t)return;$('taskIn').value='';
  await api('/tasks/add','POST',{title:t});loadTask();}
async function doneTask(id){await api('/tasks/done','POST',{id});loadTask();}

async function loadSys(){try{const {data:d}=await api('/system');
  const disks=Object.entries(d.disks||{}).map(([k,v])=>
   `<div class="row" style="margin-top:6px"><span>${k}</span><span class="muted">${v.free} своб. из ${v.total}</span></div>`).join('');
  $('sys').innerHTML=`<div class="card"><p class="t">🖥 ${esc(d.host||'ПК')}</p>
    <div class="muted">${esc(d.os||'')}</div>
    <div class="kpi" style="margin-top:12px">
      <div class="b"><div class="v">${(d.cpu||{}).percent??'—'}%</div><div class="l">CPU</div></div>
      <div class="b"><div class="v">${(d.memory||{}).percent??'—'}%</div><div class="l">RAM ${(d.memory||{}).used||''}</div></div>
    </div>${disks}
    ${d.uptime_hours!=null?`<div class="row" style="margin-top:8px"><span class="muted">Аптайм</span><span>${d.uptime_hours} ч</span></div>`:''}
   </div>`;
}catch(e){fail('sys')}}

if(TOKEN) showApp();
</script></body></html>"""


# Новый премиальный визуал (дизайн-доработка) — лежит в panel.html рядом.
# Если файла нет, панель откатывается на классическую функциональную страницу.
from pathlib import Path as _P
try:
    PAGE = (_P(__file__).parent / "panel.html").read_text("utf-8")
except Exception:
    PAGE = CLASSIC_PAGE
