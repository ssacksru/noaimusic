'use strict';
const { httpJson, Session, sleep } = require('./cdp.js');
const fs = require('node:fs');
const EXT = fs.readFileSync(__dirname + '/extid.txt', 'utf8').trim();

// 확장 서비스워커를 깨워 CDP 타깃으로 잡아온다 (MV3 SW 는 유휴 시 종료된다)
async function wakeServiceWorker() {
  for (let i = 0; i < 6; i++) {
    const list = await httpJson('/json/list');
    const bg = list.find((t) => t.url.includes(EXT) && t.type === 'service_worker');
    if (bg) return bg;
    // 팝업 페이지를 열면 SW 가 기동한다
    const page = list.find((t) => t.type === 'page');
    const s = await Session.attach(page.webSocketDebuggerUrl);
    await s.send('Page.navigate', { url: `chrome-extension://${EXT}/popup/popup.html` });
    await sleep(2000);
    s.close();
    await sleep(1000);
  }
  return null;
}
module.exports = { wakeServiceWorker, EXT };
