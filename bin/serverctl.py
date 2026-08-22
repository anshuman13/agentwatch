#!/usr/bin/env python3
"""start | stop | status for the agentwatch server."""
import os, sys, subprocess, urllib.request, time

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = os.environ.get("AGENTWATCH_PORT", "7788")
URL = f"http://127.0.0.1:{PORT}"


def up():
    try:
        urllib.request.urlopen(URL + "/api/live", timeout=0.6)
        return True
    except Exception:
        return False


def start():
    if up():
        print(f"already running {URL}")
        return
    log = os.path.expanduser("~/.claude/agentwatch/server.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "a") as f:
        subprocess.Popen([sys.executable, os.path.join(HERE, "server.py")],
                         stdout=f, stderr=f, start_new_session=True)
    for _ in range(20):
        time.sleep(0.3)
        if up():
            print(f"started {URL}")
            return
    print(f"failed to start; see {log}")
    sys.exit(1)


def stop():
    try:
        out = subprocess.run(["lsof", "-tnP", f"-iTCP:{PORT}", "-sTCP:LISTEN"],
                             capture_output=True, text=True).stdout.split()
        for pid in out:
            os.kill(int(pid), 9)
        print("stopped" if out else "not running")
    except Exception as e:
        print("stop failed:", e)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "start"
    {"start": start, "stop": stop,
     "status": lambda: print("running " + URL if up() else "not running")}.get(cmd, start)()
