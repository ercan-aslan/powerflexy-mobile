import json
from pathlib import Path

import requests

state = json.loads(Path(r"C:/Users/ilknuraslan/.expo/state.json").read_text())
session = state["auth"]["sessionSecret"]
build_id = "9736ffe0-4813-4153-8da3-957f5eb48c5d"

# Expo website logs API variants
urls = [
    f"https://expo.dev/accounts/ercanaslan3/projects/powerflexy-mobile/builds/{build_id}",
    f"https://api.expo.dev/v2/projects/fb698c1a-44e6-49cb-a596-a49f76f91e89/builds/{build_id}",
]
headers = {
    "expo-session": session,
    "cookie": f"expo-session={session}",
    "user-agent": "Mozilla/5.0",
}
for u in urls:
    r = requests.get(u, headers=headers, timeout=60)
    Path(rf"E:/web/powerflexy.com/mobile/_expo_page_{urls.index(u)}.txt").write_text(
        f"status={r.status_code}\nctype={r.headers.get('content-type')}\n\n"
        + r.text[:5000],
        encoding="utf-8",
        errors="replace",
    )
    print(u, r.status_code, r.headers.get("content-type"), len(r.text))

# GraphQL
q = {
    "query": """
    query($id: ID!) {
      builds {
        byId(buildId: $id) {
          id
          status
          error { errorCode message }
          logFiles
        }
      }
    }
    """,
    "variables": {"id": build_id},
}
g = requests.post(
    "https://api.expo.dev/graphql",
    headers={**headers, "content-type": "application/json"},
    json=q,
    timeout=60,
)
Path(r"E:/web/powerflexy.com/mobile/_expo_gql.txt").write_text(g.text[:8000], encoding="utf-8")
print("gql", g.status_code)

# download first log file from status json
status = json.loads(Path(r"E:/web/powerflexy.com/mobile/_ios_poll_status.json").read_text())
log_url = status["logFiles"][0]
lr = requests.get(log_url, timeout=60)
raw = lr.content
Path(r"E:/web/powerflexy.com/mobile/_log4.bin").write_bytes(raw)
print("log magic", list(raw[:16]), "len", len(raw))

# try bunyan / line protocol: sometimes logs are length-prefixed
# try zstd
try:
    import zstandard as zstd

    d = zstd.ZstdDecompressor().decompress(raw)
    Path(r"E:/web/powerflexy.com/mobile/_log4.txt").write_text(
        d.decode("utf-8", "replace"), encoding="utf-8"
    )
    print("zstd ok", len(d))
except Exception as e:
    print("zstd", type(e).__name__, e)

# try brotli
try:
    import brotli

    d = brotli.decompress(raw)
    Path(r"E:/web/powerflexy.com/mobile/_log4.txt").write_text(
        d.decode("utf-8", "replace"), encoding="utf-8"
    )
    print("brotli ok", len(d))
except Exception as e:
    print("brotli", type(e).__name__, e)
