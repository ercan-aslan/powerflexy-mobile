import json
from pathlib import Path

raw = Path(r"E:/web/powerflexy.com/mobile/_log4.bin").read_text(encoding="utf-8", errors="replace")
Path(r"E:/web/powerflexy.com/mobile/_log4.txt").write_text(raw, encoding="utf-8")
# maybe NDJSON
lines = []
for line in raw.splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        msg = obj.get("msg") or obj.get("message") or obj.get("line") or ""
        if isinstance(msg, dict):
            msg = json.dumps(msg)
        level = obj.get("level") or obj.get("severity") or ""
        lines.append(f"{level}: {msg}")
    except Exception:
        lines.append(line)

Path(r"E:/web/powerflexy.com/mobile/_log4_lines.txt").write_text(
    "\n".join(lines), encoding="utf-8"
)
# also whole file might be one json
try:
    obj = json.loads(raw)
    Path(r"E:/web/powerflexy.com/mobile/_log4_pretty.json").write_text(
        json.dumps(obj, indent=2)[:200000], encoding="utf-8"
    )
except Exception as e:
    Path(r"E:/web/powerflexy.com/mobile/_log4_pretty.json").write_text(
        f"not single json: {e}", encoding="utf-8"
    )
print("lines", len(lines), "raw", len(raw))
