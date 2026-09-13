#!/usr/bin/env python3
"""App Store Connect API 최소 클라이언트 — 의존성 없음(ES256 서명은 openssl).
사용: tools/asc.py GET /v1/apps?filter[bundleId]=app.aidestudio.noaimusic
      tools/asc.py POST /v1/bundleIds '{"data":{...}}'
키: ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 (env ASC_KEY_ID / ASC_ISSUER_ID 로 덮어쓰기)
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error

KEY_ID = os.environ.get("ASC_KEY_ID", "K6AH7HUK6R")
ISSUER = os.environ.get("ASC_ISSUER_ID", "f42a55f5-66a9-4e9e-a7ce-ebb13f2f5f18")
KEY_PATH = os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")
BASE = "https://api.appstoreconnect.apple.com"

def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def der2raw(der):
    # DER SEQUENCE { INTEGER r, INTEGER s } → r||s (각 32바이트)
    i = 2 if der[1] < 0x80 else 3
    out = b""
    for _ in range(2):
        assert der[i] == 0x02; ln = der[i + 1]; v = der[i + 2:i + 2 + ln]; i += 2 + ln
        v = v.lstrip(b"\x00"); out += v.rjust(32, b"\x00")
    return out

def jwt():
    now = int(time.time())
    h = b64u(json.dumps({"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}).encode())
    p = b64u(json.dumps({"iss": ISSUER, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}).encode())
    msg = f"{h}.{p}".encode()
    with tempfile.NamedTemporaryFile(delete=False) as f: f.write(msg); mp = f.name
    der = subprocess.check_output(["openssl", "dgst", "-sha256", "-sign", KEY_PATH, mp]); os.unlink(mp)
    return f"{h}.{p}.{b64u(der2raw(der))}"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", "Bearer " + jwt())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode(errors="replace")

if __name__ == "__main__":
    m, p = sys.argv[1], sys.argv[2]
    b = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    st, res = api(m, p, b)
    print(st); print(json.dumps(res, ensure_ascii=False, indent=1) if not isinstance(res, str) else res)
