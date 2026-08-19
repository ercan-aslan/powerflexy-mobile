from pathlib import Path

raw = Path(r"E:/web/powerflexy.com/mobile/_log4_lines.txt").read_text(encoding="utf-8")
out = []
for line in raw.splitlines():
    if any(
        k in line
        for k in (
            "Error validating",
            "schema",
            "app.json",
            "checks failed",
            "Importing distribution",
            "Validating whether",
            "fingerprint",
            "common name",
            "failed",
            "Failed",
            "error",
            "Error",
        )
    ):
        # ascii only
        out.append("".join(ch if ord(ch) < 128 else "?" for ch in line))
Path(r"E:/web/powerflexy.com/mobile/_log4_errors_ascii.txt").write_text(
    "\n".join(out), encoding="ascii"
)
