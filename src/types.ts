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

export type Status = "running" | "stalled" | "done";

export interface Agent {
  id: string;
  path: string;
  task_id: string | null;
  description: string | null;
  agent_type: string | null;
  parent_agent_id: string | null;
  spawn_depth: number | null;
  prompt: string;
  model: string | null;
  label: string;
  status: Status;
  tools: ToolCall[];
  tool_count: number;
  last_tool: string | null;
  last_input: string;
  final: string;
  turns: number;
  tokens: Tokens;
  cost: number | null;
  started: number | null;
  updated: number | null;
  duration: number;
  elapsed: number;
  mtime: number;
  project: string;
  session: string;
  session_dir: string;
}

export interface TaskGroup {
  task_id: string;
  description: string | null;
  project: string;
  session: string;
  agents: Agent[];
  count: number;
  tokens: Tokens;
  cost: number | null;
  cost_partial: boolean;
  started: number;
}

export interface LastFinished {
  id: string;
  description: string | null;
  project: string;
  mtime: number;
}

export interface LiveView {
  tasks: TaskGroup[];
  running: number;
  sessions_scanned: number;
  total_agents: number;
  last_finished: LastFinished | null;
  now: number;
}

export interface HistoryView {
  agents: Agent[];
  total: number;
  offset: number;
  limit: number;
  projects: string[];
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
