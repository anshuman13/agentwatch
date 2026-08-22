# agentwatch

A Claude Code plugin that shows what your subagents are doing, live, while they run.

Claude Code can fan out to many subagents at once, and the terminal tells you only that they are working. This plugin watches the transcripts they write and renders them in a local dashboard: who is running, which tool each one is on, how long they have taken, and what they produced.

## What it shows

**Live** (the main view) is a card per subagent, polling every 2 seconds. Status, elapsed time, tool count, output tokens, current tool call, and a duration bar. Session picker for switching between past runs.

**A/B** compares two groups of agents on the same task. Point it at agent prompts (regex) or at the files agents wrote (comma-separated paths or globs), give it a set of criteria, and it reports mean word count and per-criterion coverage for each arm. Built for prompt experiments: run the same task with and without a change, see whether the change cost you anything.

**Transcripts** drills into one agent: model, turn count, token breakdown including cache reads, the full prompt, every tool call in order, and the final output.

## Install

```bash
git clone https://github.com/anshuman13/agentwatch
claude --plugin-dir ./agentwatch
```

Then `/agentwatch` in Claude Code, or start it directly:

```bash
python3 bin/serverctl.py start    # http://127.0.0.1:7788
python3 bin/serverctl.py stop
python3 bin/serverctl.py status
```

Requirements: Python 3.8+. No runtime dependencies, standard library only. The dashboard
is plain HTML, CSS, and compiled JavaScript, with no CDN and no network access, so it works offline.

## Developing

The dashboard front-end is TypeScript in `src/`, compiled to `dashboard/app.js`. The compiled
output is committed, so running the plugin never needs a build step. To change the front-end:

```bash
npm install
npm run build     # or: npm run watch
```

Styling is hand-rolled Material Design 3: color roles, elevation, state layers, and ripples
in `dashboard/style.css`, following the system light and dark theme.

## How it works

`SubagentStart` and `SubagentStop` hooks record lifecycle events to `~/.claude/agentwatch/state.json` and start the dashboard server if it is not already up. The server reads the subagent transcripts Claude Code already writes to `~/.claude/projects/<project>/<session>/subagents/*.jsonl` and merges them with the hook state.

Agent status is inferred: an agent whose transcript has not been written to for 90 seconds is `idle`, one with a recorded stop is `done`, otherwise `running`. Hooks fire for every Claude Code session on the machine, so the session picker lists all of them.

Nothing leaves the machine. The server binds to `127.0.0.1` and reads local files only.

## Configuration

- `AGENTWATCH_PORT` sets the dashboard port, default `7788`.
- A/B criteria default to a set used for a parser-bug experiment. Pass your own to `/api/compare` as a `criteria` JSON array of `[name, regex]` pairs.

## License

MIT
