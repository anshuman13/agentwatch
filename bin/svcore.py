"""Parse Claude Code subagent transcripts. Stdlib only."""
import json, os, glob, time

HOME = os.path.expanduser("~")
PROJECTS = os.path.join(HOME, ".claude", "projects")
STATE_DIR = os.path.join(HOME, ".claude", "subagent-viz")
STATE = os.path.join(STATE_DIR, "state.json")


def _ts(s):
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def parse_transcript(path):
    """One subagent .jsonl -> summary dict."""
    prompt, model, tools, texts = None, None, [], []
    tok = {"in": 0, "out": 0, "cache_r": 0, "cache_w": 0}
    first = last = None
    turns = 0

    try:
        fh = open(path, "r", errors="replace")
    except OSError:
        return None

    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            t = _ts(d.get("timestamp"))
            if t:
                first = t if first is None else min(first, t)
                last = t if last is None else max(last, t)

            typ = d.get("type")
            msg = d.get("message") or {}

            if typ == "user" and prompt is None:
                c = msg.get("content")
                if isinstance(c, str):
                    prompt = c
                elif isinstance(c, list):
                    prompt = " ".join(
                        b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"
                    )

            if typ == "assistant":
                turns += 1
                model = msg.get("model") or model
                u = msg.get("usage") or {}
                tok["in"] += u.get("input_tokens") or 0
                tok["out"] += u.get("output_tokens") or 0
                tok["cache_r"] += u.get("cache_read_input_tokens") or 0
                tok["cache_w"] += u.get("cache_creation_input_tokens") or 0
                for b in msg.get("content") or []:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "tool_use":
                        tools.append({"name": b.get("name"), "input": _brief(b.get("input")), "t": t})
                    elif b.get("type") == "text" and b.get("text", "").strip():
                        texts.append(b["text"])

    return {
        "id": os.path.basename(path).replace("agent-", "").replace(".jsonl", ""),
        "path": path,
        "prompt": (prompt or "").strip(),
        "model": model,
        "tools": tools,
        "tool_count": len(tools),
        "final": texts[-1] if texts else "",
        "turns": turns,
        "tokens": tok,
        "started": first,
        "updated": last,
        "duration": (last - first) if (first and last) else 0,
        "mtime": os.path.getmtime(path) if os.path.exists(path) else 0,
    }


def _brief(inp, n=90):
    if not isinstance(inp, dict):
        return ""
    for k in ("file_path", "command", "pattern", "path", "url", "prompt"):
        if k in inp:
            return str(inp[k])[:n]
    return (json.dumps(inp)[:n] if inp else "")


def find_sessions():
    """All subagent dirs, newest first."""
    out = []
    for d in glob.glob(os.path.join(PROJECTS, "*", "*", "subagents")):
        parts = d.split(os.sep)
        out.append({
            "project": parts[-3],
            "session": parts[-2],
            "dir": d,
            "mtime": os.path.getmtime(d),
        })
    return sorted(out, key=lambda x: x["mtime"], reverse=True)


def load_agents(session_dir):
    res = []
    for f in glob.glob(os.path.join(session_dir, "*.jsonl")):
        a = parse_transcript(f)
        if a:
            res.append(a)
    return sorted(res, key=lambda a: a["started"] or 0)


def read_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {"agents": {}}


def write_state(s):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATE)


def mark(agent_id, **kw):
    """Hook-called: record lifecycle events."""
    s = read_state()
    a = s["agents"].get(agent_id, {})
    a.update(kw)
    s["agents"][agent_id] = a
    write_state(s)
    return a


STALE_AFTER = 90  # no transcript write for this long => treat as finished


def live_view(session_dir=None):
    """Merge hook state + transcript data into the monitor payload."""
    sess = find_sessions()
    if session_dir is None:
        session_dir = sess[0]["dir"] if sess else None
    if not session_dir:
        return {"agents": [], "session": None, "now": time.time()}

    st = read_state().get("agents", {})
    agents = load_agents(session_dir)
    now = time.time()

    for a in agents:
        h = st.get(a["id"], {})
        a["label"] = h.get("label") or h.get("agent_type") or "agent"
        a["agent_type"] = h.get("agent_type")
        if h.get("stopped"):
            a["status"] = "done"
        elif now - a["mtime"] > STALE_AFTER:
            a["status"] = "idle"
        else:
            a["status"] = "running"
        a["last_tool"] = a["tools"][-1]["name"] if a["tools"] else None
        a["elapsed"] = (h.get("stopped") or a["mtime"]) - (a["started"] or a["mtime"])

    return {
        "agents": agents,
        "session": session_dir,
        "sessions": sess[:12],
        "now": now,
        "running": sum(1 for a in agents if a["status"] == "running"),
    }
