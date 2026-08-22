const $ = (s) => {
    const el = document.querySelector(s);
    if (!el)
        throw new Error(`missing element: ${s}`);
    return el;
};
const $$ = (s) => Array.from(document.querySelectorAll(s));
let SESSION = null;
let LAST = null;
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = (s) => s < 60 ? `${Math.round(s)}s`
    : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
const num = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const label = (p) => {
    if (!p)
        return "";
    const parts = p.split(",").map((x) => x.trim().split("/").pop()).filter(Boolean);
    return parts.length > 2 ? `${parts[0]} +${parts.length - 1}` : parts.join(", ") || p;
};
const ICON = {
    running: "▶",
    idle: "⏸",
    done: "✔",
};
function ripple(e, host) {
    const r = document.createElement("span");
    const box = host.getBoundingClientRect();
    const size = Math.max(box.width, box.height);
    r.className = "ripple";
    r.style.width = r.style.height = `${size}px`;
    r.style.left = `${e.clientX - box.left - size / 2}px`;
    r.style.top = `${e.clientY - box.top - size / 2}px`;
    host.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
}
document.addEventListener("click", (e) => {
    const t = e.target?.closest(".md-ripple");
    if (t)
        ripple(e, t);
});
function selectTab(view) {
    $$(".tab").forEach((x) => {
        const on = x.dataset.view === view;
        x.classList.toggle("active", on);
        x.setAttribute("aria-selected", String(on));
    });
    $$(".view").forEach((x) => x.classList.toggle("active", x.id === view));
    const ind = $(".tab-indicator");
    const active = $$(".tab").find((x) => x.dataset.view === view);
    if (active) {
        ind.style.width = `${active.offsetWidth}px`;
        ind.style.transform = `translateX(${active.offsetLeft}px)`;
    }
    if (view === "tx")
        renderTx();
    if (view === "ab")
        void runAB();
}
$$(".tab").forEach((t) => {
    t.addEventListener("click", () => selectTab(t.dataset.view));
});
$("#session").addEventListener("change", (e) => {
    SESSION = e.target.value || null;
    void poll();
});
async function poll() {
    try {
        const url = "/api/live" + (SESSION ? `?session=${encodeURIComponent(SESSION)}` : "");
        const res = await fetch(url);
        const d = (await res.json());
        LAST = d;
        render(d);
        $("#status").textContent = new Date().toLocaleTimeString();
        $("#status").classList.remove("offline");
    }
    catch {
        $("#status").textContent = "server offline";
        $("#status").classList.add("offline");
        $("#pulse").classList.remove("on");
    }
}
function statCard(value, lbl, icon) {
    return `<div class="stat">
    <span class="material-icon">${icon}</span>
    <div><b>${value}</b><span>${esc(lbl)}</span></div>
  </div>`;
}
function render(d) {
    const sel = $("#session");
    if (d.sessions && sel.options.length !== d.sessions.length) {
        sel.innerHTML = d.sessions
            .map((s) => `<option value="${esc(s.dir)}">${esc(s.project.slice(-26))} · ${esc(s.session.slice(0, 8))}</option>`)
            .join("");
        if (d.session)
            sel.value = d.session;
    }
    const A = d.agents || [];
    const run = A.filter((a) => a.status === "running").length;
    $("#pulse").classList.toggle("on", run > 0);
    const tot = A.reduce((s, a) => s + a.tokens.out, 0);
    const tools = A.reduce((s, a) => s + a.tool_count, 0);
    $("#stats").innerHTML = [
        statCard(run, "running", "⚡"),
        statCard(A.length, "agents", "◉"),
        statCard(tools, "tool calls", "⚒"),
        statCard(num(tot), "output tokens", "▤"),
        statCard(dur(A.reduce((s, a) => s + a.duration, 0)), "total time", "◷"),
    ].join("");
    $("#live-empty").hidden = A.length > 0;
    const max = Math.max(...A.map((a) => a.duration), 1);
    $("#cards").innerHTML = A.slice().reverse().map((a) => {
        const last = a.tools.length ? a.tools[a.tools.length - 1] : null;
        return `<div class="card ${a.status} md-ripple">
      <div class="card-head">
        <div class="title">
          <span class="material-icon st">${ICON[a.status]}</span>
          <span class="name">${esc(a.label)}</span>
          <span class="id">${esc(a.id.slice(0, 8))}</span>
        </div>
        <span class="chip ${a.status}">${a.status}</span>
      </div>
      <p class="prompt">${esc(a.prompt.slice(0, 150))}</p>
      <div class="metrics">
        <span><b>${dur(a.duration)}</b>elapsed</span>
        <span><b>${a.tool_count}</b>tools</span>
        <span><b>${num(a.tokens.out)}</b>out</span>
        <span><b>${a.turns}</b>turns</span>
      </div>
      ${a.last_tool ? `<div class="tool"><span class="material-icon">⌨</span>
        <code>${esc(a.last_tool)}${last ? ` · ${esc(last.input.slice(0, 46))}` : ""}</code></div>` : ""}
      <div class="progress ${a.status === "running" ? "indeterminate" : ""}">
        <i style="width:${Math.max(3, (a.duration / max) * 100)}%"></i>
      </div>
    </div>`;
    }).join("");
}
function syncHint() {
    const f = $("#mode").value === "files";
    $("#ab-hint").textContent = f
        ? "Comma-separated file paths or globs, e.g. /path/c*.md"
        : "Regex matched against each agent's prompt.";
}
async function runAB() {
    const files = $("#mode").value === "files";
    syncHint();
    const a = $("#pa").value;
    const b = $("#pb").value;
    const q = new URLSearchParams(files ? { ga: a, gb: b } : { a, b });
    if (SESSION)
        q.set("session", SESSION);
    const res = await fetch(`/api/compare?${q.toString()}`);
    const d = (await res.json());
    const A = d.a;
    const B = d.b;
    if (!A.rows.length && !B.rows.length) {
        $("#ab-out").innerHTML = `<div class="empty"><span class="material-icon">∅</span>
      Nothing matched. ${files
            ? "Check the file globs (comma-separated paths allowed)."
            : "Patterns are regex-matched against agent prompts."}</div>`;
        return;
    }
    const cmp = (x, y, lower = false) => x === y ? "" : (lower ? x < y : x > y) ? "win" : "";
    const rows = [
        `<tr><td>runs</td><td class="num">${A.agg.n}</td><td class="num">${B.agg.n}</td></tr>`,
        `<tr><td>mean words</td><td class="num ${cmp(A.agg.words, B.agg.words, true)}">${A.agg.words}</td><td class="num ${cmp(B.agg.words, A.agg.words, true)}">${B.agg.words}</td></tr>`,
        `<tr><td>mean criteria hit</td><td class="num ${cmp(A.agg.hits, B.agg.hits)}">${A.agg.hits}</td><td class="num ${cmp(B.agg.hits, A.agg.hits)}">${B.agg.hits}</td></tr>`,
    ];
    if (!files) {
        rows.push(`<tr><td>mean output tokens</td><td class="num">${num(A.agg.tokens)}</td><td class="num">${num(B.agg.tokens)}</td></tr>`);
        rows.push(`<tr><td>mean duration</td><td class="num">${dur(A.agg.duration)}</td><td class="num">${dur(B.agg.duration)}</td></tr>`);
    }
    const cov = d.criteria.map((c) => {
        const ah = A.rows.filter((r) => r.hits.includes(c)).length;
        const bh = B.rows.filter((r) => r.hits.includes(c)).length;
        const cls = (h, n) => (h === n && h ? "hit" : h ? "" : "miss");
        return `<tr><td>${esc(c)}</td>
      <td class="num ${cls(ah, A.rows.length)}">${ah}/${A.rows.length}</td>
      <td class="num ${cls(bh, B.rows.length)}">${bh}/${B.rows.length}</td></tr>`;
    }).join("");
    $("#ab-out").innerHTML = `
    <div class="surface">
      <h2><span class="material-icon">◧</span> Summary</h2>
      <table><thead><tr><th>Metric</th>
        <th>A · ${esc(label(A.pattern))}</th>
        <th>B · ${esc(label(B.pattern))}</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table>
    </div>
    <div class="surface">
      <h2><span class="material-icon">✓</span> Criteria coverage</h2>
      <table><thead><tr><th>criterion</th><th>A hits</th><th>B hits</th></tr></thead>
      <tbody>${cov}</tbody></table>
    </div>`;
}
$("#run-ab").addEventListener("click", () => void runAB());
$("#mode").addEventListener("change", () => {
    syncHint();
    const pa = $("#pa");
    const pb = $("#pb");
    if ($("#mode").value === "files" && pa.value === "control") {
        pa.value = "";
        pb.value = "";
    }
});
function tokenBar(t) {
    const total = Math.max(t.in + t.out + t.cache_r + t.cache_w, 1);
    const seg = (k, cls) => `<i class="${cls}" style="width:${(t[k] / total) * 100}%" title="${k}: ${t[k]}"></i>`;
    return `<div class="tokenbar">${seg("out", "s-out")}${seg("in", "s-in")}${seg("cache_r", "s-cr")}${seg("cache_w", "s-cw")}</div>`;
}
function renderTx() {
    const A = (LAST && LAST.agents) || [];
    $("#tx-list").innerHTML = A.map((a) => `<div class="tx-item md-ripple" data-id="${esc(a.id)}">
      <div class="tx-top"><span class="material-icon ${a.status}">${ICON[a.status]}</span>
        <b>${esc(a.id.slice(0, 8))}</b>
        <span class="tx-meta">${a.tool_count} tools · ${dur(a.duration)}</span></div>
      <div class="tx-sub">${esc(a.prompt.slice(0, 60))}</div>
    </div>`).join("")
        || `<div class="empty"><span class="material-icon">∅</span>No agents.</div>`;
    $$(".tx-item").forEach((el) => {
        el.addEventListener("click", async () => {
            $$(".tx-item").forEach((x) => x.classList.remove("sel"));
            el.classList.add("sel");
            const res = await fetch(`/api/agent?id=${encodeURIComponent(el.dataset.id)}`);
            const d = (await res.json());
            $("#tx-detail").innerHTML = `
        <div class="surface">
          <h2>${esc(d.id.slice(0, 12))} <span class="model">${esc(d.model || "")}</span></h2>
          <div class="metrics wide">
            <span><b>${d.turns}</b>turns</span>
            <span><b>${d.tool_count}</b>tools</span>
            <span><b>${num(d.tokens.out)}</b>output</span>
            <span><b>${num(d.tokens.cache_r)}</b>cache read</span>
            <span><b>${dur(d.duration)}</b>elapsed</span>
          </div>
          ${tokenBar(d.tokens)}
        </div>
        <div class="surface"><h2><span class="material-icon">✎</span> Prompt</h2>
          <pre>${esc(d.prompt)}</pre></div>
        <div class="surface"><h2><span class="material-icon">≡</span> Steps</h2>
          <ol class="steps">${d.tools.map((t) => `<li><span class="sname">${esc(t.name)}</span><code>${esc(t.input)}</code></li>`).join("")
                || "<li><em>none</em></li>"}</ol></div>
        <div class="surface"><h2><span class="material-icon">↳</span> Final output</h2>
          <pre>${esc(d.final.slice(0, 6000))}</pre></div>`;
        });
    });
}
selectTab("live");
void poll();
window.setInterval(() => void poll(), 2000);
export {};
