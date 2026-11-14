/* Настройки сайта INTELLECT. Откуда брать актуальный адрес API (ПК доступен через
   туннель, адрес которого меняется при перезапуске ПК):
   1) api.json рядом со страницей (если сайт отдаёт сам бот — файла нет, и тогда
      используется адрес самой страницы);
   2) api.json в служебной ветке intellect-api этого репозитория — бот записывает
      его сам после старта туннеля (нужен GITHUB_TOKEN в .env на ПК). */
window.INTELLECT_CONFIG = {
  apiSources: [
    'api.json',
    'https://raw.githubusercontent.com/sofiy7544/Npbot-/intellect-api/api.json',
  ],
};
