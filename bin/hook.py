#!/usr/bin/env python3
"""Hook entry: records subagent lifecycle, ensures the server is up. Never blocks."""
import json, sys, os, subprocess, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def ensure_server(port):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/live", timeout=0.4)
        return
    except Exception:
        pass
    srv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
    log = os.path.expanduser("~/.claude/subagent-viz/server.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "a") as f:
        subprocess.Popen([sys.executable, srv], stdout=f, stderr=f,
                         start_new_session=True)

def main():
    try:
        raw = sys.stdin.read()
        d = json.loads(raw) if raw.strip() else {}
    except Exception:
        d = {}

    port = os.environ.get("SUBAGENT_VIZ_PORT", "7788")
    try:
        ensure_server(port)
    except Exception:
        pass

    try:
        import svcore
        ev = d.get("hook_event_name", "")
        aid = d.get("agent_id") or d.get("agentId") or ""
        if aid:
            if ev == "SubagentStart":
                svcore.mark(aid, agent_type=d.get("agent_type"),
                            label=d.get("agent_name") or d.get("agent_type"),
                            started=time.time(), stopped=None)
            elif ev == "SubagentStop":
                svcore.mark(aid, stopped=time.time())
    except Exception:
        pass

    print(json.dumps({}))
    sys.exit(0)

if __name__ == "__main__":
    main()
