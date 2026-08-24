'use strict';
const { httpJson, Session, sleep } = require('./cdp.js');
const fs = require('node:fs');
// 확장 ID: 환경변수 NAM_EXT_ID 로 주거나, 이 폴더에 extid.txt 를 둔다
// (개발용 테스트 하네스 — 로드한 확장마다 ID 가 달라 저장소에 넣지 않는다)
const EXT = (process.env.NAM_EXT_ID
  || (fs.existsSync(__dirname + '/extid.txt')
      ? fs.readFileSync(__dirname + '/extid.txt', 'utf8') : '')).trim();
if (!EXT) {
  console.error('확장 ID 가 없다. NAM_EXT_ID=<id> 를 주거나 tools/extid.txt 를 만들어라.');
  process.exit(1);
}

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
