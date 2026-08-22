---
description: Open the subagent-viz dashboard (starts the local server if needed).
---

Start the subagent-viz server if it is not already running, then report the URL.

Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/bin/serverctl.py" start
```

Report the URL it prints and tell the user the dashboard is at http://127.0.0.1:7788 — the Live tab polls every 2 seconds, A/B compares two arms, Transcripts drills into a single agent.
