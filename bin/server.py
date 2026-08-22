#!/usr/bin/env python3
"""agentwatch local dashboard. Stdlib only."""
import json, os, sys, re, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svcore

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.join(os.path.dirname(HERE), "public")

# Bugs verified against invoice_matching; used by the A/B view.
DEFAULT_CRITERIA = [
    ["unicode-minus", r"U\+2212|unicode minus|en.dash|em.dash"],
    ["parens-negative", r"parenthes|\(\s*\d[\d\s.,]*\)"],
    ["lone-dot-1000x", r"1\.250|1\.234|12\.345|lone (period|dot)|bare (period|dot)"],
    ["comma-decimals", r"1,2345|12,345|three.decimal|exactly two"],
    ["bankers-rounding", r"half.even|HALF_EVEN|banker"],
    ["invalid-operation", r"InvalidOperation"],
    ["nfkc-digits", r"NFKC|fullwidth|full-width|subscript|superscript"],
    ["parse-quantity", r"parse_quantity"],
]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path

        if p == "/":
            return self._file("index.html", "text/html; charset=utf-8")
        if p == "/app.js":
            return self._file("app.js", "text/javascript")

        if p == "/api/live":
            return self._send(200, svcore.running_view())

        if p == "/api/history":
            def _int(name, dflt):
                try:
                    return int(q.get(name, [dflt])[0])
                except (TypeError, ValueError):
                    return dflt
            return self._send(200, svcore.history_view(
                project=q.get("project", [None])[0],
                limit=max(1, min(_int("limit", 60), 200)),
                offset=max(0, _int("offset", 0)),
            ))

        if p == "/api/agent":
            aid = q.get("id", [""])[0]
            for s in svcore.find_sessions():
                f = os.path.join(s["dir"], f"agent-{aid}.jsonl")
                if os.path.exists(f):
                    a = svcore.parse_transcript(f)
                    if a is None:
                        return self._send(404, {"error": "unreadable"})
                    a["project"], a["session"], a["session_dir"] = s["project"], s["session"], s["dir"]
                    return self._send(200, svcore._decorate(
                        a, svcore.read_state().get("agents", {}), time.time()))
            return self._send(404, {"error": "not found"})

        if p == "/api/compare":
            return self._send(200, self._compare(q))

        return self._send(404, {"error": "no route"})

    def _file(self, name, ctype):
        fp = os.path.join(DASH, name)
        if not os.path.exists(fp):
            return self._send(404, "missing", "text/plain")
        with open(fp, "rb") as f:
            return self._send(200, f.read(), ctype)

    def _compare(self, q):
        """Compare two arms. Sources: agent prompts (regex) or output files (glob)."""
        sess = q.get("session", [None])[0]
        crit = DEFAULT_CRITERIA
        raw = q.get("criteria", [None])[0]
        if raw:
            try:
                crit = json.loads(raw)
            except Exception:
                pass

        ga, gb = q.get("ga", [""])[0], q.get("gb", [""])[0]
        if ga or gb:
            A = self._from_files(ga, crit)
            B = self._from_files(gb, crit)
            la, lb = ga, gb
        else:
            view = svcore.live_view(sess)
            la = q.get("a", ["control"])[0]
            lb = q.get("b", ["skill"])[0]
            A = self._from_agents(view, la, crit)
            B = self._from_agents(view, lb, crit)

        def agg(rows):
            n = len(rows) or 1
            return {
                "n": len(rows),
                "words": round(sum(r["words"] for r in rows) / n),
                "tokens": round(sum(r.get("tokens", 0) for r in rows) / n),
                "duration": round(sum(r.get("duration", 0) for r in rows) / n),
                "hits": round(sum(len(r["hits"]) for r in rows) / n, 1),
            }

        return {
            "criteria": [c[0] for c in crit],
            "a": {"pattern": la, "rows": A, "agg": agg(A)},
            "b": {"pattern": lb, "rows": B, "agg": agg(B)},
        }

    def _score(self, text, crit):
        return [c[0] for c in crit if re.search(c[1], text, re.I)]

    def _from_files(self, pattern, crit):
        import glob as _g
        rows, seen = [], set()
        files = []
        for part in pattern.split(","):
            part = part.strip()
            if part:
                files.extend(_g.glob(os.path.expanduser(part)))
        for f in sorted(dict.fromkeys(files)):
            if f in seen:
                continue
            seen.add(f)
            try:
                t = open(f, errors="replace").read()
            except OSError:
                continue
            rows.append({
                "id": os.path.basename(f), "words": len(t.split()),
                "tokens": 0, "duration": 0, "tools": 0,
                "hits": self._score(t, crit), "prompt": f,
            })
        return rows

    def _from_agents(self, view, pat, crit):
        rx = re.compile(pat, re.I)
        rows = []
        for a in view["agents"]:
            blob = (a["prompt"] or "") + " " + (a.get("label") or "")
            if not rx.search(blob):
                continue
            text = a["final"] or ""
            rows.append({
                "id": a["id"], "words": len(text.split()),
                "tokens": a["tokens"]["out"], "duration": a["duration"],
                "tools": a["tool_count"], "hits": self._score(text, crit),
                "prompt": a["prompt"][:120],
            })
        return rows


def main():
    port = int(os.environ.get("AGENTWATCH_PORT", "7788"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"agentwatch http://127.0.0.1:{port}")
    sys.stdout.flush()
    srv.serve_forever()


if __name__ == "__main__":
    main()
