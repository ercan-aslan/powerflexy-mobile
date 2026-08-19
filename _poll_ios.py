import json
import subprocess
import time
from pathlib import Path

BUILD_ID = "2ff92c1f-0dc0-43c2-b1df-49695f911154"
OUT = Path(r"E:/web/powerflexy.com/mobile/_ios_poll_status.json")


def view():
    out = subprocess.check_output(
        [
            "cmd",
            "/c",
            f"set EAS_NO_VCS=1&& npx eas-cli@latest build:view {BUILD_ID} --json",
        ],
        cwd=r"E:\web\powerflexy.com\mobile",
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    data = json.loads(out[out.find("{") : out.rfind("}") + 1])
    OUT.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def main():
    for i in range(40):
        data = view()
        status = data.get("status")
        print(i, status, flush=True)
        if status in ("FINISHED", "ERRORED", "CANCELED"):
            print("done", status)
            arts = data.get("artifacts") or {}
            print("archive", arts.get("applicationArchiveUrl") or arts.get("buildUrl"))
            print("error", data.get("error"))
            return
        time.sleep(45)
    print("timeout")


if __name__ == "__main__":
    main()
