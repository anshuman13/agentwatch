const $ = (s) => {
    const el = document.querySelector(s);
    if (!el)
        throw new Error(`missing element: ${s}`);
    return el;
};
const $$ = (s) => Array.from(document.querySelectorAll(s));
let LAST = null;
let VIEW = "live";
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = (s) => s < 60 ? `${Math.round(s)}s`
    : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
const num = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const money = (c, partial = false) => typeof c !== "number" ? "n/a"
    : `${partial ? "≥" : ""}$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`;
const proj = (p) => p.replace(/^-Users-[^-]+-/, "").replace(/-/g, "/");
const ago = (t) => {
    const d = Date.now() / 1000 - t;
    if (d < 60)
        return "just now";
    if (d < 3600)
        return `${Math.floor(d / 60)}m ago`;
    if (d < 86400)
        return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
};
const DOT = {
    running: "bg-run animate-pulse",
    stalled: "bg-idle",
    done: "bg-done",
};
function selectTab(view) {
    VIEW = view;
    $$(".tab").forEach((t) => {
        const on = t.dataset.view === view;
        t.classList.toggle("text-slate-900", on);
        t.classList.toggle("border-sky-600", on);
        t.classList.toggle("text-slate-600", !on);
        t.classList.toggle("border-transparent", !on);
        t.setAttribute("aria-selected", String(on));
    });
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== view));
    if (view === "history")
        void loadHistory();
    if (view === "ab")
        void runAB();
    if (view === "tx")
        renderTx();
}
$$(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.view)));
// ---------- Live ----------
function agentRow(a) {
    const tool = a.last_tool
        ? `<span class="text-sky-700">${esc(a.last_tool)}</span>${a.last_input ? ` <span class="text-slate-500">${esc(a.last_input.slice(0, 60))}</span>` : ""}`
        : `<span class="text-slate-400">starting…</span>`;
    return `<div class="flex items-center gap-3 px-4 py-2.5 border-t border-ink-line text-sm">
    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.status]}"></span>
    <span class="font-mono text-xs text-slate-500 w-16 shrink-0">${esc(a.id.slice(0, 8))}</span>
    <span class="flex-1 min-w-0 truncate font-mono text-xs">${tool}</span>
    <span class="font-mono text-xs text-slate-600 w-12 text-right shrink-0">${dur(a.elapsed)}</span>
    <span class="font-mono text-xs text-slate-600 w-14 text-right shrink-0">${num(a.tokens.out)}</span>
    <span class="font-mono text-xs text-slate-600 w-16 text-right shrink-0">${money(a.cost)}</span>
  </div>`;
}
function taskTitle(t) {
    const names = [...new Set(t.agents.map((a) => a.description).filter(Boolean))];
    if (!names.length)
        return "(no description)";
    if (names.length === 1)
        return names[0];
    return `${names[0]} +${names.length - 1} more`;
}
function taskBlock(t) {
    return `<div class="rounded-xl bg-ink-soft border border-ink-line overflow-hidden">
    <div class="flex items-start gap-3 px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate">${esc(taskTitle(t))}</div>
        <div class="text-xs text-slate-500 font-mono truncate mt-0.5">
          ${esc(proj(t.project))} · ${esc(t.session.slice(0, 8))}
        </div>
      </div>
      <div class="flex items-center gap-4 text-right shrink-0">
        <div><div class="font-mono text-sm">${t.count}</div><div class="text-[10px] uppercase tracking-wide text-slate-500">agents</div></div>
        <div><div class="font-mono text-sm">${num(t.tokens.out)}</div><div class="text-[10px] uppercase tracking-wide text-slate-500">out</div></div>
        <div><div class="font-mono text-sm">${money(t.cost, t.cost_partial)}</div><div class="text-[10px] uppercase tracking-wide text-slate-500">est. cost</div></div>
      </div>
    </div>
    ${t.agents.map(agentRow).join("")}
  </div>`;
}
function renderLive(d) {
    $("#pulse").className = `w-2 h-2 rounded-full ${d.running ? "bg-run animate-pulse" : "bg-slate-400"}`;
    $("#scan").textContent = `${d.sessions_scanned} sessions · ${d.total_agents} agents`;
    if (!d.tasks.length) {
        const lf = d.last_finished;
        $("#live").innerHTML = `<div class="rounded-xl bg-ink-soft border border-ink-line p-12 text-center">
      <div class="text-slate-900 font-medium">Nothing running right now</div>
      ${lf ? `<div class="text-sm text-slate-500 mt-4 pt-4 border-t border-ink-line inline-block px-6">
        Last finished: <span class="text-slate-900">${esc(lf.description || lf.id.slice(0, 8))}</span>
        <span class="text-slate-400">·</span> ${esc(proj(lf.project))}
        <span class="text-slate-400">·</span> ${ago(lf.mtime)}
      </div>` : ""}
    </div>`;
        return;
    }
    const totalCost = d.tasks.reduce((s, t) => s + (t.cost ?? 0), 0);
    const totalOut = d.tasks.reduce((s, t) => s + t.tokens.out, 0);
    $("#live").innerHTML = `
    <div class="flex items-center gap-6 mb-4 text-sm">
      <span><b class="font-mono text-lg">${d.running}</b> <span class="text-slate-500">running</span></span>
      <span><b class="font-mono text-lg">${d.tasks.length}</b> <span class="text-slate-500">tasks</span></span>
      <span><b class="font-mono text-lg">${num(totalOut)}</b> <span class="text-slate-500">out</span></span>
      <span><b class="font-mono text-lg">${money(totalCost)}</b> <span class="text-slate-500">est. cost</span></span>
      <span class="ml-auto text-xs text-slate-500">Press Esc in the originating session to stop an agent.</span>
    </div>
    <div class="space-y-3">${d.tasks.map(taskBlock).join("")}</div>`;
}
async function poll() {
    try {
        const d = (await (await fetch("/api/live")).json());
        LAST = d;
        if (VIEW === "live")
            renderLive(d);
        $("#status").textContent = new Date().toLocaleTimeString();
        $("#status").classList.remove("text-red-600");
    }
    catch {
        $("#status").textContent = "server offline";
        $("#status").classList.add("text-red-600");
    }
}
// ---------- History ----------
let HFILTER = "";
async function loadHistory() {
    const q = new URLSearchParams({ limit: "60" });
    if (HFILTER)
        q.set("project", HFILTER);
    const d = (await (await fetch(`/api/history?${q}`)).json());
    const opts = ["<option value=''>all projects</option>"]
        .concat(d.projects.map((p) => `<option value="${esc(p)}"${p === HFILTER ? " selected" : ""}>${esc(proj(p))}</option>`))
        .join("");
    const cards = d.agents.map((a) => `
    <div class="rounded-lg bg-ink-soft border border-ink-line p-3">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.status]}"></span>
        <span class="font-mono text-xs text-slate-500">${esc(a.id.slice(0, 8))}</span>
        <span class="ml-auto font-mono text-xs text-slate-500">${money(a.cost)}</span>
      </div>
      <div class="text-sm truncate">${esc(a.description || a.prompt.slice(0, 60) || "(untitled)")}</div>
      <div class="text-xs text-slate-500 font-mono truncate mt-1">${esc(proj(a.project))}</div>
      <div class="flex gap-3 mt-2 text-[11px] font-mono text-slate-500">
        <span>${dur(a.duration)}</span><span>${a.tool_count} tools</span>
        <span>${num(a.tokens.out)} out</span><span>${ago(a.mtime)}</span>
      </div>
    </div>`).join("");
    $("#history").innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <select id="hproj" class="bg-ink-soft border border-ink-line rounded-lg px-3 py-1.5 text-sm">${opts}</select>
      <span class="text-sm text-slate-500">${d.total} finished runs</span>
    </div>
    <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${cards}</div>`;
    $("#hproj").addEventListener("change", (e) => {
        HFILTER = e.target.value;
        void loadHistory();
    });
}
// ---------- A/B ----------
const label = (p) => {
    if (!p)
        return "";
    const parts = p.split(",").map((x) => x.trim().split("/").pop()).filter(Boolean);
    return parts.length > 2 ? `${parts[0]} +${parts.length - 1}` : parts.join(", ") || p;
};
function abShell() {
    if ($("#ab").dataset.ready)
        return;
    $("#ab").dataset.ready = "1";
    $("#ab").innerHTML = `
    <div class="flex flex-wrap items-end gap-3 rounded-xl bg-ink-soft border border-ink-line p-4 mb-4">
      <label class="flex flex-col gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">Mode
        <select id="mode" class="bg-ink border border-ink-line rounded-lg px-3 py-1.5 text-sm normal-case text-slate-800">
          <option value="prompt">match prompts</option><option value="files">score files</option>
        </select></label>
      <label class="flex flex-col gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">Arm A
        <input id="pa" value="control" class="bg-ink border border-ink-line rounded-lg px-3 py-1.5 text-sm text-slate-800"></label>
      <label class="flex flex-col gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">Arm B
        <input id="pb" value="skill" class="bg-ink border border-ink-line rounded-lg px-3 py-1.5 text-sm text-slate-800"></label>
      <button id="run-ab" class="bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-full px-5 py-2 text-sm">Compare</button>
      <span id="ab-hint" class="text-xs text-slate-500"></span>
    </div>
    <div id="ab-out"></div>`;
    $("#run-ab").addEventListener("click", () => void runAB());
    $("#mode").addEventListener("change", () => {
        syncHint();
        const pa = $("#pa"), pb = $("#pb");
        if ($("#mode").value === "files" && pa.value === "control") {
            pa.value = "";
            pb.value = "";
        }
    });
}
function syncHint() {
    $("#ab-hint").textContent = $("#mode").value === "files"
        ? "Comma-separated file paths or globs, e.g. /path/c*.md"
        : "Regex matched against each agent's prompt.";
}
const TBL = "w-full text-sm border-collapse";
const TH = "text-left font-medium text-slate-500 text-xs px-3 py-2 border-b border-ink-line";
const TD = "px-3 py-2.5 border-b border-ink-line";
async function runAB() {
    abShell();
    syncHint();
    const files = $("#mode").value === "files";
    const a = $("#pa").value, b = $("#pb").value;
    const q = new URLSearchParams(files ? { ga: a, gb: b } : { a, b });
    const d = (await (await fetch(`/api/compare?${q}`)).json());
    if (!d.a.rows.length && !d.b.rows.length) {
        $("#ab-out").innerHTML = `<div class="rounded-xl bg-ink-soft border border-ink-line p-10 text-center text-slate-500">
      Nothing matched. ${files ? "Check the file globs." : "Patterns are regex-matched against agent prompts."}</div>`;
        return;
    }
    const win = (x, y, lower = false) => x === y ? "" : (lower ? x < y : x > y) ? "text-run font-medium" : "";
    const N = "font-mono text-right";
    const rows = [
        `<tr><td class="${TD}">runs</td><td class="${TD} ${N}">${d.a.agg.n}</td><td class="${TD} ${N}">${d.b.agg.n}</td></tr>`,
        `<tr><td class="${TD}">mean words</td><td class="${TD} ${N} ${win(d.a.agg.words, d.b.agg.words, true)}">${d.a.agg.words}</td><td class="${TD} ${N} ${win(d.b.agg.words, d.a.agg.words, true)}">${d.b.agg.words}</td></tr>`,
        `<tr><td class="${TD}">mean criteria hit</td><td class="${TD} ${N} ${win(d.a.agg.hits, d.b.agg.hits)}">${d.a.agg.hits}</td><td class="${TD} ${N} ${win(d.b.agg.hits, d.a.agg.hits)}">${d.b.agg.hits}</td></tr>`,
    ];
    if (!files) {
        rows.push(`<tr><td class="${TD}">mean output tokens</td><td class="${TD} ${N}">${num(d.a.agg.tokens)}</td><td class="${TD} ${N}">${num(d.b.agg.tokens)}</td></tr>`);
        rows.push(`<tr><td class="${TD}">mean duration</td><td class="${TD} ${N}">${dur(d.a.agg.duration)}</td><td class="${TD} ${N}">${dur(d.b.agg.duration)}</td></tr>`);
    }
    const cov = d.criteria.map((c) => {
        const ah = d.a.rows.filter((r) => r.hits.includes(c)).length;
        const bh = d.b.rows.filter((r) => r.hits.includes(c)).length;
        const cls = (h, n) => h === n && h ? "text-run" : h ? "" : "text-red-600";
        return `<tr><td class="${TD}">${esc(c)}</td>
      <td class="${TD} ${N} ${cls(ah, d.a.rows.length)}">${ah}/${d.a.rows.length}</td>
      <td class="${TD} ${N} ${cls(bh, d.b.rows.length)}">${bh}/${d.b.rows.length}</td></tr>`;
    }).join("");
    const card = (title, head, body) => `<div class="rounded-xl bg-ink-soft border border-ink-line p-5 mb-4">
      <h2 class="font-medium mb-3">${title}</h2>
      <table class="${TBL}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    $("#ab-out").innerHTML =
        card("Summary", `<tr><th class="${TH}">Metric</th><th class="${TH} text-right">A · ${esc(label(d.a.pattern))}</th><th class="${TH} text-right">B · ${esc(label(d.b.pattern))}</th></tr>`, rows.join("")) +
            card("Criteria coverage", `<tr><th class="${TH}">criterion</th><th class="${TH} text-right">A hits</th><th class="${TH} text-right">B hits</th></tr>`, cov);
}
// ---------- Transcripts ----------
function tokenBar(t) {
    const total = Math.max(t.in + t.out + t.cache_r + t.cache_w, 1);
    const seg = (k, cls) => `<i class="${cls}" style="width:${(t[k] / total) * 100}%" title="${k}: ${t[k]}"></i>`;
    return `<div class="flex h-2 rounded-full overflow-hidden mt-3 bg-ink [&>i]:block">
    ${seg("out", "bg-sky-600")}${seg("in", "bg-violet-500")}${seg("cache_r", "bg-slate-400")}${seg("cache_w", "bg-slate-300")}</div>`;
}
function renderTx() {
    const all = (LAST?.tasks.flatMap((t) => t.agents)) ?? [];
    void (async () => {
        const h = (await (await fetch("/api/history?limit=40")).json());
        const list = [...all, ...h.agents];
        $("#tx").innerHTML = `<div class="flex gap-4 items-start">
      <div id="tx-list" class="w-72 shrink-0 rounded-xl bg-ink-soft border border-ink-line p-2 max-h-[calc(100vh-140px)] overflow-y-auto"></div>
      <div id="tx-detail" class="flex-1 min-w-0"></div></div>`;
        $("#tx-list").innerHTML = list.map((a) => `<div class="tx-item px-3 py-2.5 rounded-lg cursor-pointer hover:bg-slate-100" data-id="${esc(a.id)}">
        <div class="flex items-center gap-2 text-sm">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.status]}"></span>
          <span class="font-mono text-xs">${esc(a.id.slice(0, 8))}</span>
          <span class="ml-auto text-[11px] text-slate-500">${a.tool_count}⚒ ${dur(a.duration)}</span>
        </div>
        <div class="text-[11px] text-slate-500 truncate mt-1">${esc(a.description || a.prompt.slice(0, 50))}</div>
      </div>`).join("") || `<div class="p-6 text-center text-slate-500 text-sm">No agents.</div>`;
        $("#tx-detail").innerHTML = `<div class="rounded-xl bg-ink-soft border border-ink-line p-10 text-center text-slate-500">Select an agent.</div>`;
        $$(".tx-item").forEach((el) => el.addEventListener("click", async () => {
            $$(".tx-item").forEach((x) => x.classList.remove("bg-sky-50"));
            el.classList.add("bg-sky-50");
            const a = (await (await fetch(`/api/agent?id=${encodeURIComponent(el.dataset.id)}`)).json());
            const box = "rounded-xl bg-ink-soft border border-ink-line p-5 mb-4";
            const pre = "bg-ink border border-ink-line rounded-lg p-3 overflow-auto max-h-80 text-xs font-mono text-slate-600 whitespace-pre-wrap break-words";
            const stat = (v, l) => `<div><div class="font-mono text-base">${v}</div><div class="text-[10px] uppercase tracking-wide text-slate-500">${l}</div></div>`;
            $("#tx-detail").innerHTML = `
        <div class="${box}">
          <h2 class="font-medium">${esc(a.id.slice(0, 12))}
            <span class="font-mono text-xs text-slate-500 ml-2">${esc(a.model || "")}</span></h2>
          <div class="flex gap-6 mt-3">
            ${stat(String(a.turns), "turns")}${stat(String(a.tool_count), "tools")}
            ${stat(num(a.tokens.out), "output")}${stat(num(a.tokens.cache_r), "cache read")}
            ${stat(dur(a.duration), "elapsed")}${stat(money(a.cost), "est. cost")}
          </div>${tokenBar(a.tokens)}
        </div>
        <div class="${box}"><h2 class="font-medium mb-3">Prompt</h2><pre class="${pre}">${esc(a.prompt)}</pre></div>
        <div class="${box}"><h2 class="font-medium mb-3">Steps</h2>
          <ol class="space-y-0">${a.tools.map((t, i) => `
            <li class="flex items-baseline gap-2.5 py-1.5 border-b border-ink-line last:border-0 text-xs">
              <span class="font-mono text-[10px] text-slate-400 w-5 shrink-0 text-right">${i + 1}</span>
              <span class="font-mono font-medium text-sky-700 shrink-0">${esc(t.name)}</span>
              <span class="font-mono text-slate-500 truncate">${esc(t.input)}</span>
            </li>`).join("") || `<li class="text-slate-400 text-xs">none</li>`}</ol></div>
        <div class="${box}"><h2 class="font-medium mb-3">Final output</h2>
          <pre class="${pre}">${esc(a.final.slice(0, 6000))}</pre></div>`;
        }));
    })();
}
selectTab("live");
void poll();
window.setInterval(() => void poll(), 2000);
export {};
