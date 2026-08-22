"""Parse Claude Code subagent transcripts. Stdlib only."""
import json, os, glob, time

HOME = os.path.expanduser("~")
PROJECTS = os.path.join(HOME, ".claude", "projects")
STATE_DIR = os.path.join(HOME, ".claude", "agentwatch")
STATE = os.path.join(STATE_DIR, "state.json")


def _ts(s):
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


RATES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


NOT_BILLABLE = {"<synthetic>"}


def _rate(model):
    """Resolve a model id to (input, output) $/MTok. None => unknown, never guessed.

    Only a bare id or a dated snapshot (claude-opus-5-20260514) resolves. A
    bracketed variant such as claude-opus-5[1m] denotes different pricing we do
    not have a rate for, so it stays unknown rather than being billed as the
    base model.
    """
    if not model or model in NOT_BILLABLE:
        return None
    if "[" in model:
        return None
    if model in RATES:
        return RATES[model]
    best = None
    for k, v in RATES.items():
        if model.startswith(k + "-") and model[len(k) + 1:].isdigit():
            if best is None or len(k) > len(best[0]):
                best = (k, v)
    return best[1] if best else None


def cost_of(model, tok):
    """Local estimate from recorded tokens. No API call. None if the model is unknown."""
    r = _rate(model)
    if not r:
        return None
    inp, out = r
    return (tok["in"] * inp
            + tok["out"] * out
            + tok["cache_r"] * inp * 0.1
            + tok["cache_w"] * inp * 1.25) / 1e6


def _read_meta(path):
    try:
        with open(path.replace(".jsonl", ".meta.json"), errors="replace") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def parse_transcript(path):
    """One subagent .jsonl -> summary dict."""
    prompt, model, tools, texts = None, None, [], []
    tok = {"in": 0, "out": 0, "cache_r": 0, "cache_w": 0}
    first = last = None
    turns = 0
    task_id = None

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

            if task_id is None:
                task_id = d.get("promptId")

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

    meta = _read_meta(path)
    return {
        "id": os.path.basename(path).replace("agent-", "").replace(".jsonl", ""),
        "path": path,
        "task_id": task_id,
        "description": meta.get("description"),
        "agent_type": meta.get("agentType"),
        "parent_agent_id": meta.get("parentAgentId"),
        "spawn_depth": meta.get("spawnDepth"),
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


_CACHE = {}


def parse_cached(path):
    """parse_transcript keyed by (path, mtime). Re-parses only changed transcripts."""
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return None
    hit = _CACHE.get(path)
    if hit and hit[0] == mt:
        return hit[1]
    a = parse_transcript(path)
    if a is not None:
        _CACHE[path] = (mt, a)
    return a


def load_agents(session_dir):
    res = []
    for f in glob.glob(os.path.join(session_dir, "*.jsonl")):
        a = parse_cached(f)
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
            a["status"] = "stalled"
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


def _decorate(a, hook_state, now):
    h = hook_state.get(a["id"], {})
    a["label"] = h.get("label") or a.get("agent_type") or "agent"
    if h.get("stopped"):
        a["status"] = "done"
    elif now - a["mtime"] > STALE_AFTER:
        a["status"] = "stalled"
    else:
        a["status"] = "running"
    a["last_tool"] = a["tools"][-1]["name"] if a["tools"] else None
    a["last_input"] = a["tools"][-1]["input"] if a["tools"] else ""
    a["elapsed"] = (h.get("stopped") or a["mtime"]) - (a["started"] or a["mtime"])
    a["cost"] = cost_of(a["model"], a["tokens"])
    return a


def scan_all():
    """Every agent across every local session, decorated. Cheap after warm-up."""
    st = read_state().get("agents", {})
    now = time.time()
    out = []
    for s in find_sessions():
        for a in load_agents(s["dir"]):
            a = dict(a)
            a["project"] = s["project"]
            a["session"] = s["session"]
            a["session_dir"] = s["dir"]
            out.append(_decorate(a, st, now))
    return out


def _sum_tokens(agents):
    t = {"in": 0, "out": 0, "cache_r": 0, "cache_w": 0}
    for a in agents:
        for k in t:
            t[k] += a["tokens"][k]
    return t


def running_view():
    """In-flight agents across ALL local sessions, grouped by task."""
    every = scan_all()
    live = [a for a in every if a["status"] == "running"]

    tasks = {}
    for a in live:
        key = a["task_id"] or a["id"]
        g = tasks.setdefault(key, {
            "task_id": key,
            "description": a.get("description"),
            "project": a["project"],
            "session": a["session"],
            "agents": [],
        })
        g["agents"].append(a)
        if not g["description"] and a.get("description"):
            g["description"] = a["description"]

    groups = []
    for g in tasks.values():
        g["agents"].sort(key=lambda a: a["started"] or 0)
        g["count"] = len(g["agents"])
        g["tokens"] = _sum_tokens(g["agents"])
        costs = [a["cost"] for a in g["agents"] if a["cost"] is not None]
        g["cost"] = sum(costs) if costs else None
        g["cost_partial"] = len(costs) != len(g["agents"])
        g["started"] = min((a["started"] or 0) for a in g["agents"])
        groups.append(g)
    groups.sort(key=lambda g: g["started"], reverse=True)

    finished = [a for a in every if a["status"] != "running"]
    finished.sort(key=lambda a: a["mtime"], reverse=True)
    last = finished[0] if finished else None

    return {
        "tasks": groups,
        "running": len(live),
        "sessions_scanned": len(find_sessions()),
        "total_agents": len(every),
        "last_finished": {
            "id": last["id"], "description": last.get("description"),
            "project": last["project"], "mtime": last["mtime"],
        } if last else None,
        "now": time.time(),
    }


def history_view(project=None, limit=60, offset=0):
    """Finished agents, newest first, optionally filtered by project."""
    every = [a for a in scan_all() if a["status"] != "running"]
    if project:
        every = [a for a in every if a["project"] == project]
    every.sort(key=lambda a: a["mtime"], reverse=True)
    projects = sorted({a["project"] for a in scan_all()})
    return {
        "agents": every[offset:offset + limit],
        "total": len(every),
        "offset": offset,
        "limit": limit,
        "projects": projects,
    }
