# agentwatch

A Claude Code plugin that shows what your subagents are doing, live, while they run.

Claude Code can fan out to many subagents at once, and the terminal tells you only that they are working. This plugin watches the transcripts they write and renders them in a local dashboard: who is running, which tool each one is on, how long they have taken, and what they produced.

## What it shows

**Live** (the main view) shows only what is running right now, across every local Claude Code session, polling every 2 seconds. Agents are grouped by the task that spawned them, so a fan-out of six subagents reads as one task with six rows rather than six unrelated cards. Each row shows the tool call in flight, elapsed time, output tokens, and an estimated cost.

**A/B** compares two groups of agents on the same task. Point it at agent prompts (regex) or at the files agents wrote (comma-separated paths or globs), give it a set of criteria, and it reports mean word count and per-criterion coverage for each arm. Built for prompt experiments: run the same task with and without a change, see whether the change cost you anything.

**Transcripts** lists every agent, running and finished, filterable by project and paged 40 at a time. Selecting one drills into it: model, turn count, token breakdown including cache reads, estimated cost, the full prompt, every tool call in order, and the final output.

### About the cost figures

agentwatch makes no API calls. It reads the transcripts Claude Code already writes to disk and multiplies the recorded token counts by a rate table in `bin/svcore.py`. That makes the dollar figures **estimates, not billing data**: the rates go stale when pricing changes, they are wrong on Bedrock and Vertex partner pricing, and they cannot see subscription plans, discounts, or batch rates. An unrecognised model shows `n/a` rather than being billed at a guessed rate. Use them to compare runs against each other, not to reconcile an invoice.

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

Requirements: Python 3.8+ for the server, which uses the standard library only.

The dashboard styles itself with Tailwind loaded from `https://cdn.tailwindcss.com`, so the
page needs network access to render correctly and will appear unstyled offline. The Python
server itself never reaches the network: it binds `127.0.0.1` and reads local files only.

## Developing

The front-end is TypeScript in `src/`, compiled to `public/`. The compiled output is
committed, so running the plugin never needs a build step. To change the front-end:

```bash
yarn install
yarn build     # tsc + copy src/index.html to public/
yarn watch     # tsc --watch; re-copy the HTML yourself if you edit it
```

`tsc` runs under `strict` with `noUnusedLocals`, `noUnusedParameters`, and
`exactOptionalPropertyTypes`, so the build doubles as a lint gate. Styling is Tailwind
utility classes, configured inline in `src/index.html`.

## How it works

`SubagentStart` and `SubagentStop` hooks record lifecycle events to `~/.claude/agentwatch/state.json` and start the dashboard server if it is not already up. The server reads the subagent transcripts Claude Code already writes to `~/.claude/projects/<project>/<session>/subagents/*.jsonl` and merges them with the hook state.

Every poll scans all local sessions. Parsed transcripts are cached by path and mtime, so a
poll re-parses only the files that changed. A full cold scan of 61 transcripts takes about
80 ms, and warm polls about 2 ms.

Agents are grouped into tasks by the `promptId` recorded in each transcript, and named from
the `agent-*.meta.json` sidecar Claude Code writes alongside it.

Status is inferred: an agent with a recorded stop is `done`; one whose transcript has not
been written to for 90 seconds is `stalled` (which covers both a crash and a stop the hook
missed); otherwise `running`.

**There is no way to stop a running subagent from the dashboard.** Subagents run inside the
`claude` process rather than as separate OS processes, and no hook payload, meta file, or
transcript carries a process id or cancellation handle. Press Esc in the session that
started the agent.

## Configuration

- `AGENTWATCH_PORT` sets the dashboard port, default `7788`.
- A/B criteria default to a set used for a parser-bug experiment. Pass your own to `/api/compare` as a `criteria` JSON array of `[name, regex]` pairs.

## License

MIT
