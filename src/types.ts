export interface Tokens {
  in: number;
  out: number;
  cache_r: number;
  cache_w: number;
}

export interface ToolCall {
  name: string;
  input: string;
  t: number;
}

export type Status = "running" | "idle" | "done";

export interface Agent {
  id: string;
  path: string;
  label: string;
  agent_type: string;
  prompt: string;
  model: string;
  status: Status;
  tools: ToolCall[];
  tool_count: number;
  last_tool: string | null;
  final: string;
  turns: number;
  tokens: Tokens;
  started: number;
  updated: number;
  duration: number;
  elapsed: number;
  mtime: number;
}

export interface SessionRef {
  dir: string;
  session: string;
  project: string;
  mtime: number;
}

export interface LiveView {
  agents: Agent[];
  session: string | null;
  sessions: SessionRef[];
  now: number;
  running: number;
}

export interface CompareRow {
  id: string;
  words: number;
  tokens: number;
  duration: number;
  tools: number;
  hits: string[];
  prompt: string;
}

export interface CompareAgg {
  n: number;
  words: number;
  tokens: number;
  duration: number;
  hits: number;
}

export interface Arm {
  pattern: string;
  rows: CompareRow[];
  agg: CompareAgg;
}

export interface Compare {
  criteria: string[];
  a: Arm;
  b: Arm;
}
