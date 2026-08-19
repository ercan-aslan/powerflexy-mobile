#!/usr/bin/env python3
"""Enable Push Notifications on PowerFlexy bundle + recreate App Store profile."""
import base64
import json
import time
from pathlib import Path

import jwt
import requests

ROOT = Path(r"E:/web/powerflexy.com/mobile")
CRED = ROOT / "credentials"
KEY_ID = "9G25JDJRZR"
ISSUER = "ad300a90-3b98-4947-88a3-9070636212c7"
P8 = (ROOT / "AuthKey_9G25JDJRZR.p8").read_text()
BUNDLE_ID_RES = "55W52F838X"
CERT_ID = "7RRUUWA8P4"


def headers():
    now = int(time.time())
    tok = jwt.encode(
        {"iss": ISSUER, "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"},
        P8,
        algorithm="ES256",
        headers={"kid": KEY_ID},
    )
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def main():
    # List existing capabilities
    r = requests.get(
        f"https://api.appstoreconnect.apple.com/v1/bundleIds/{BUNDLE_ID_RES}/bundleIdCapabilities",
        headers=headers(),
        timeout=60,
    )
    print("caps", r.status_code)
    caps = r.json().get("data") or []
    for c in caps:
        print(" ", c.get("id"), (c.get("attributes") or {}).get("capabilityType"))

    has_push = any(
        (c.get("attributes") or {}).get("capabilityType") == "PUSH_NOTIFICATIONS"
        for c in caps
    )
    if not has_push:
        body = {
            "data": {
                "type": "bundleIdCapabilities",
                "attributes": {"capabilityType": "PUSH_NOTIFICATIONS", "settings": []},
                "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": BUNDLE_ID_RES}}
                },
            }
        }
        c = requests.post(
            "https://api.appstoreconnect.apple.com/v1/bundleIdCapabilities",
            headers=headers(),
            json=body,
            timeout=60,
        )
        print("enable push", c.status_code, c.text[:500])
        if c.status_code not in (200, 201):
            raise SystemExit("failed to enable push")
    else:
        print("push already enabled")

    # Recreate profile
    pr = requests.get(
        "https://api.appstoreconnect.apple.com/v1/profiles",
        headers=headers(),
        params={
            "filter[profileType]": "IOS_APP_STORE",
            "filter[name]": "PowerFlexy AppStore",
            "limit": 10,
        },
        timeout=60,
    )
    for old in pr.json().get("data") or []:
        d = requests.delete(
            f"https://api.appstoreconnect.apple.com/v1/profiles/{old['id']}",
            headers=headers(),
            timeout=60,
        )
        print("delete profile", old["id"], d.status_code)

    body = {
        "data": {
            "type": "profiles",
            "attributes": {
                "name": "PowerFlexy AppStore",
                "profileType": "IOS_APP_STORE",
            },
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": BUNDLE_ID_RES}},
                "certificates": {"data": [{"type": "certificates", "id": CERT_ID}]},
            },
        }
    }
    p = requests.post(
        "https://api.appstoreconnect.apple.com/v1/profiles",
        headers=headers(),
        json=body,
        timeout=60,
    )
    print("profile create", p.status_code)
    if p.status_code not in (200, 201):
        raise SystemExit(p.text[:800])
    (CRED / "profile.mobileprovision").write_bytes(
        base64.b64decode(p.json()["data"]["attributes"]["profileContent"])
    )
    print("wrote profile.mobileprovision")


if __name__ == "__main__":
    main()
