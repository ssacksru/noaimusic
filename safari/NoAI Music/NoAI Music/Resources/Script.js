// 앱 창 문구는 시스템 언어를 따른다 — 확장 팝업(_locales)과 같은 언어로 보여야 한다
// (Mac App Store 가이드라인 4 거절, 2026-09-22).
const KO = (navigator.language || "").toLowerCase().startsWith("ko");
const TEXT = KO ? {
    on: "NoAI Music 확장이 켜져 있습니다. Safari 설정의 확장 프로그램에서 끌 수 있습니다.",
    off: "NoAI Music 확장이 꺼져 있습니다. Safari 설정의 확장 프로그램에서 켤 수 있습니다.",
    unknown: "Safari 설정의 확장 프로그램에서 NoAI Music 확장을 켤 수 있습니다.",
    open: "종료하고 Safari 설정 열기…",
} : {
    on: "NoAI Music’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.",
    off: "NoAI Music’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.",
    unknown: "You can turn on NoAI Music’s extension in the Extensions section of Safari Settings.",
    open: "Quit and Open Safari Settings…",
};

document.documentElement.lang = KO ? "ko" : "en";
document.getElementsByClassName('state-on')[0].innerText = TEXT.on;
document.getElementsByClassName('state-off')[0].innerText = TEXT.off;
document.getElementsByClassName('state-unknown')[0].innerText = TEXT.unknown;
document.getElementsByClassName('open-preferences')[0].innerText = TEXT.open;

// 최소 macOS 13 이라 언제나 "Settings" 문구다 — 두 번째 인자는 변환기 템플릿 호환용으로만 받는다
function show(enabled, useSettingsInsteadOfPreferences) {
    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
