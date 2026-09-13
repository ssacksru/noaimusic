#!/usr/bin/env python3
"""Mac App Store 배포 프로파일을 (재)생성해 로컬에 설치한다 — export 가 계정 세션 없이 수동 서명으로 통과하게.
포털의 활성 DISTRIBUTION 인증서를 전부 넣는다(어느 Apple Distribution identity 를 집어도 통과, 가이드 §7.5.4)."""
import base64, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from asc import api

TARGETS = {
    "app.aidestudio.noaimusic": "NoAI Music Mac App Store",
    "app.aidestudio.noaimusic.Extension": "NoAI Music Extension Mac App Store",
}
DIRS = [os.path.expanduser("~/Library/MobileDevice/Provisioning Profiles"),
        os.path.expanduser("~/Library/Developer/Xcode/UserData/Provisioning Profiles")]

def main():
    st, certs = api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50")
    assert st == 200, certs
    cert_ids = [c["id"] for c in certs["data"]]
    for ident, name in TARGETS.items():
        st, b = api("GET", f"/v1/bundleIds?filter[identifier]={ident}")
        bid = next(x["id"] for x in b["data"] if x["attributes"]["identifier"] == ident)
        st, old = api("GET", f"/v1/profiles?filter[name]={name.replace(' ', '%20')}")
        for p in (old or {}).get("data", []):
            api("DELETE", f"/v1/profiles/{p['id']}")
        st, r = api("POST", "/v1/profiles", {"data": {"type": "profiles",
            "attributes": {"name": name, "profileType": "MAC_APP_STORE"},
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid}},
                              "certificates": {"data": [{"type": "certificates", "id": c} for c in cert_ids]}}}})
        assert st == 201, r
        a = r["data"]["attributes"]
        content = base64.b64decode(a["profileContent"])
        for d in DIRS:
            os.makedirs(d, exist_ok=True)
            open(os.path.join(d, a["uuid"] + ".provisionprofile"), "wb").write(content)
        print(f"{name}: {a['uuid']} ({a['profileState']}, 인증서 {len(cert_ids)}개)")

if __name__ == "__main__":
    main()
