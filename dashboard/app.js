const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let SESSION = null, TIMER = null, LAST = null;

const label = p => {
  if (!p) return "";
  const parts = p.split(",").map(x => x.trim().split("/").pop()).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} +${parts.length - 1}` : parts.join(", ") || p;
};
const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = s => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
const num = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);

$$(".tab").forEach(t => t.onclick = () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".view").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("#" + t.dataset.view).classList.add("active");
  if (t.dataset.view === "tx") renderTx();
  if (t.dataset.view === "ab") runAB();
});

$("#session").onchange = e => { SESSION = e.target.value || null; poll(); };

async function poll() {
  try {
    const url = "/api/live" + (SESSION ? "?session=" + encodeURIComponent(SESSION) : "");
    const d = await (await fetch(url)).json();
    LAST = d;
    render(d);
    $("#status").textContent = new Date().toLocaleTimeString();
  } catch (e) {
    $("#status").textContent = "server offline";
    $("#pulse").classList.remove("on");
  }
}

function render(d) {
  const sel = $("#session");
  if (d.sessions && sel.options.length !== d.sessions.length) {
    sel.innerHTML = d.sessions.map(s =>
      `<option value="${esc(s.dir)}">${esc(s.project.slice(-26))} · ${esc(s.session.slice(0, 8))}</option>`).join("");
    if (d.session) sel.value = d.session;
  }

  const A = d.agents || [];
  const run = A.filter(a => a.status === "running").length;
  $("#pulse").classList.toggle("on", run > 0);

  const tot = A.reduce((s, a) => s + a.tokens.out, 0);
  const tools = A.reduce((s, a) => s + a.tool_count, 0);
  $("#stats").innerHTML = [
    ["running", run], ["agents", A.length], ["tool calls", tools],
    ["output tokens", num(tot)],
    ["total time", dur(A.reduce((s, a) => s + a.duration, 0))],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");

  $("#live-empty").hidden = A.length > 0;
  const max = Math.max(...A.map(a => a.duration), 1);
  $("#cards").innerHTML = A.slice().reverse().map(a => `
    <div class="card ${a.status}">
      <h3><span>${esc(a.label)} · ${esc(a.id.slice(0, 8))}</span>
        <span class="badge ${a.status}">${a.status}</span></h3>
      <div class="prompt">${esc(a.prompt.slice(0, 150))}</div>
      <div class="row">
        <span><b>${dur(a.duration)}</b></span>
        <span><b>${a.tool_count}</b> tools</span>
        <span><b>${num(a.tokens.out)}</b> out</span>
        <span><b>${a.turns}</b> turns</span>
      </div>
      ${a.last_tool ? `<div class="tool">▸ ${esc(a.last_tool)}${a.tools.length ? " · " + esc(a.tools[a.tools.length - 1].input.slice(0, 46)) : ""}</div>` : ""}
      <div class="bar"><i style="width:${Math.max(3, a.duration / max * 100)}%"></i></div>
    </div>`).join("");
}

async function runAB() {
  const files = $("#mode").value === "files";
  syncHint();
  const q = new URLSearchParams(files
    ? { ga: $("#pa").value, gb: $("#pb").value }
    : { a: $("#pa").value, b: $("#pb").value });
  if (SESSION) q.set("session", SESSION);
  const d = await (await fetch("/api/compare?" + q)).json();
  const A = d.a, B = d.b;
  if (!A.rows.length && !B.rows.length) {
    $("#ab-out").innerHTML = `<div class="empty">Nothing matched. ${$("#mode").value === "files" ? "Check the file globs (comma-separated paths allowed)." : "Patterns are regex-matched against agent prompts."}</div>`;
    return;
  }
  const cmp = (x, y, lower) => x === y ? "" : (lower ? x < y : x > y) ? "win" : "";
  $("#ab-out").innerHTML = `
    <table><thead><tr><th>Metric</th><th>A · ${esc(label(A.pattern))}</th><th>B · ${esc(label(B.pattern))}</th></tr></thead>
    <tbody>
      <tr><td>runs</td><td class="num">${A.agg.n}</td><td class="num">${B.agg.n}</td></tr>
      <tr><td>mean words</td><td class="num ${cmp(A.agg.words, B.agg.words, 1)}">${A.agg.words}</td><td class="num ${cmp(B.agg.words, A.agg.words, 1)}">${B.agg.words}</td></tr>
      <tr><td>mean criteria hit</td><td class="num ${cmp(A.agg.hits, B.agg.hits)}">${A.agg.hits}</td><td class="num ${cmp(B.agg.hits, A.agg.hits)}">${B.agg.hits}</td></tr>
      ${files ? "" : `<tr><td>mean output tokens</td><td class="num">${num(A.agg.tokens)}</td><td class="num">${num(B.agg.tokens)}</td></tr>
      <tr><td>mean duration</td><td class="num">${dur(A.agg.duration)}</td><td class="num">${dur(B.agg.duration)}</td></tr>`}
    </tbody></table>
    <h2>Criteria coverage</h2>
    <table><thead><tr><th>criterion</th><th>A hits</th><th>B hits</th></tr></thead><tbody>
    ${d.criteria.map(c => {
      const a = A.rows.filter(r => r.hits.includes(c)).length, b = B.rows.filter(r => r.hits.includes(c)).length;
      return `<tr><td>${esc(c)}</td>
        <td class="num ${a === A.rows.length && a ? "hit" : a ? "" : "miss"}">${a}/${A.rows.length}</td>
        <td class="num ${b === B.rows.length && b ? "hit" : b ? "" : "miss"}">${b}/${B.rows.length}</td></tr>`;
    }).join("")}</tbody></table>`;
}
$("#run-ab").onclick = runAB;
function syncHint() {
  const f = $("#mode").value === "files";
  $("#ab-hint").textContent = f
    ? "Comma-separated file paths or globs, e.g. /path/c*.md"
    : "Regex matched against each agent's prompt.";
}
$("#mode").onchange = () => {
  syncHint();
  if ($("#mode").value === "files" && $("#pa").value === "control") { $("#pa").value = ""; $("#pb").value = ""; }
};

function renderTx() {
  const A = (LAST && LAST.agents) || [];
  $("#tx-list").innerHTML = A.map(a =>
    `<div class="tx-item" data-id="${a.id}"><b>${esc(a.id.slice(0, 8))}</b> · ${a.tool_count} tools · ${dur(a.duration)}
     <div style="color:var(--faint);margin-top:3px">${esc(a.prompt.slice(0, 60))}</div></div>`).join("")
    || `<div class="empty">No agents.</div>`;
  $$(".tx-item").forEach(el => el.onclick = async () => {
    $$(".tx-item").forEach(x => x.classList.remove("sel"));
    el.classList.add("sel");
    const d = await (await fetch("/api/agent?id=" + el.dataset.id)).json();
    $("#tx-detail").innerHTML = `
      <h2>${esc(d.id.slice(0, 12))} <span style="color:var(--faint);font-weight:400">${esc(d.model || "")}</span></h2>
      <div class="row"><span><b>${d.turns}</b> turns</span><span><b>${d.tool_count}</b> tools</span>
        <span><b>${num(d.tokens.out)}</b> out</span><span><b>${num(d.tokens.cache_r)}</b> cache read</span>
        <span><b>${dur(d.duration)}</b></span></div>
      <h2>Prompt</h2><pre>${esc(d.prompt)}</pre>
      <h2>Steps</h2><ul class="steps">${d.tools.map(t => `<li>${esc(t.name)} <em>${esc(t.input)}</em></li>`).join("") || "<li><em>none</em></li>"}</ul>
      <h2>Final output</h2><pre>${esc(d.final.slice(0, 6000))}</pre>`;
  });
}

poll();
TIMER = setInterval(poll, 2000);
