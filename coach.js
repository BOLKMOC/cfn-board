// CFN Closer Coach, ChatGPT style. One engine for both the full page (board.changefn.com/coach) and the bubble on every page.
// Chats are saved on the server, answers stream in, practice calls, voice, thumbs up/down. It never contacts clients.
(() => {
  let session = null;
  try { session = localStorage.getItem("cfn_session"); } catch {}
  const isPage = document.body.dataset.coachPage === "1";
  if (!isPage && (!session || document.body.classList.contains("tv") || /[?&]tv=1/.test(location.search) || /tv=1/.test(location.hash))) return;
  const API = window.BOARD_API;
  const PERSONAS = [["skeptical", "Skeptical caller"], ["spouse", "Needs to talk to my spouse"], ["lawsuit", "Worried about lawsuits"],
    ["credit", "Credit score worrier"], ["other_program", "Already in another program"], ["price", "Can't afford the payment"], ["", "Surprise me"]];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // Safe Markdown: everything is escaped first, then a few formats are added back. No links, no HTML.
  function md(src) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const out = []; let list = null, quote = [];
    const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`); quote = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const raw of String(src).replace(/\r/g, "").split("\n")) {
      const line = raw.trimEnd();
      let m;
      if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushList(); quote.push(m[1]); continue; }
      flushQuote();
      if (!line.trim()) continue; // a blank line between list items keeps the list (and its numbering) going
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
      flushList();
      if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { out.push(`<p><b>${inline(m[1])}</b></p>`); continue; }
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    flushQuote(); flushList();
    return out.join("");
  }
  const visible = (t) => String(t).split(/\n\s*Sources:/i)[0]; // hide the sources line while it streams in

  async function call(path, body) {
    const r = await fetch(API + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + session, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw Object.assign(new Error("signin"), { signin: true });
    if (!r.ok) throw new Error(j.error || "Something went wrong.");
    return j;
  }
  async function stream(body, onEvent, signal) {
    const r = await fetch(API + "/coach", { method: "POST", signal, headers: { Authorization: "Bearer " + session, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) throw Object.assign(new Error("signin"), { signin: true });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("event-stream")) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "The coach is not answering right now."); }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1], data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (ev && data) onEvent(ev, JSON.parse(data));
      }
    }
  }

  // Builds the chat UI inside root. opts.sidebar: show saved chats (full page). opts.onExpand: bubble's Expand button.
  function mount(root, opts = {}) {
    root.innerHTML = `
      ${opts.sidebar ? `<aside class="cc-side"><button class="cc-new">+ New chat</button><button class="cc-practice">&#127908; Practice a call</button><div class="cc-list"></div>
        <div class="cc-side-foot"><a href="/" class="cc-back">&larr; Back to the board</a><br><br>Coaching only. It can't contact clients.<br>Never type or say SSNs or bank numbers.</div></aside>` : ""}
      <section class="cc-main">
        <header class="cc-top">${opts.sidebar ? '<button class="cc-menu" aria-label="Chats">&#9776;</button>' : ""}<b class="cc-title">CFN Coach</b>
          <span class="cc-tools">${opts.sidebar ? "" : '<button class="cc-newb" title="New chat">&#65291;</button>'}<button class="cc-speak" title="Read answers out loud" aria-pressed="false">&#128264;</button>${opts.onExpand ? '<button class="cc-expand" title="Open full screen">&#10530;</button>' : ""}${opts.onClose ? '<button class="cc-close" aria-label="Close">&times;</button>' : ""}</span></header>
        <div class="cc-log" aria-live="polite"></div>
        <form class="cc-form"><div class="cc-box"><textarea rows="1" maxlength="4000" placeholder="Message the Coach"></textarea>
          <button type="button" class="cc-mic" title="Talk" hidden>&#127908;</button><button type="submit" class="cc-send" aria-label="Send">&#8593;</button></div>
          <div class="cc-hint">Enter to send, Shift+Enter for a new line. CFN facts come from the CFN library.</div></form>
      </section>`;
    const $ = (s) => root.querySelector(s);
    const log = $(".cc-log"), box = $("textarea"), send = $(".cc-send"), mic = $(".cc-mic");
    let conv = null, msgs = [], busy = null, start = null;

    const signInNote = () => { log.innerHTML = '<div class="cc-empty"><h2>Sign in to use the Coach</h2><p><a href="/me">Sign in with your CFN Google account</a></p></div>'; };
    const ago = (iso) => { const d = new Date(iso), t = new Date(); const day = (x) => x.toDateString(); return day(d) === day(t) ? "Today" : day(d) === day(new Date(t - 864e5)) ? "Yesterday" : "Earlier"; };

    async function loadList() {
      if (!opts.sidebar) return;
      try {
        const { chats } = await call("/coach/chats");
        const list = $(".cc-list"); list.innerHTML = "";
        let group = "";
        for (const c of chats) {
          const g = ago(c.updated_at); if (g !== group) { group = g; list.append(el("div", "cc-group", g)); }
          const row = el("div", "cc-item" + (conv && conv.conv_id === c.conv_id ? " on" : ""));
          const name = el("button", "cc-name", c.title); name.onclick = () => openChat(c.conv_id);
          const ren = el("button", "cc-mini", "✎"); ren.title = "Rename"; ren.onclick = async () => { const t = prompt("Rename this chat", c.title); if (t) { await call("/coach/chats", { conv_id: c.conv_id, title: t }); loadList(); } };
          const del = el("button", "cc-mini", "🗑"); del.title = "Delete"; del.onclick = async () => { if (confirm("Delete this chat?")) { await call("/coach/chats", { conv_id: c.conv_id, delete: true }); if (conv?.conv_id === c.conv_id) newChat(); loadList(); } };
          row.append(name, ren, del); list.append(row);
        }
        if (!chats.length) list.append(el("div", "cc-group", "Your chats will show up here."));
      } catch (e) { if (e.signin) signInNote(); }
    }
    async function openChat(id) {
      try {
        const c = await call("/coach/chats?id=" + encodeURIComponent(id));
        conv = c.conv; msgs = c.messages; put("cfn_coach_last", conv.conv_id); render(); loadList(); root.classList.remove("cc-side-open");
        if (isPage) history.replaceState(null, "", "#c=" + id);
      } catch (e) { if (e.signin) signInNote(); else newChat(); }
    }
    async function newChat() {
      conv = null; msgs = []; put("cfn_coach_last", ""); if (isPage) history.replaceState(null, "", location.pathname); render(); loadList(); root.classList.remove("cc-side-open"); box.focus();
    }
    function render() {
      $(".cc-title").textContent = conv ? conv.title : "CFN Coach";
      log.innerHTML = "";
      if (!msgs.length) {
        const e = el("div", "cc-empty");
        e.innerHTML = `<h2>${esc(start?.greeting || "Hey, I'm your CFN Coach.")}</h2><p>Ask what to say, paste what the client just said, or practice a call.</p>`;
        const chips = el("div", "cc-chips");
        for (const s of (start?.suggestions || [])) { const b = el("button", "", s); b.type = "button"; b.onclick = () => ask(s); chips.append(b); }
        const p = el("button", "cc-chip-practice", "🎤 Practice a call"); p.type = "button"; p.onclick = pickPersona; chips.append(p);
        e.append(chips); log.append(e);
      }
      msgs.forEach((m, i) => log.append(bubble(m, i === msgs.length - 1)));
      if (conv?.mode === "practice") {
        const bar = el("div", "cc-practice-bar");
        bar.innerHTML = `<span>Practice call: you're the closer. Type or talk.</span>`;
        const sc = el("button", "", "Score my call"); sc.type = "button"; sc.onclick = scoreCall; bar.append(sc); log.append(bar);
      }
      log.scrollTop = log.scrollHeight;
    }
    function bubble(m, last) {
      const w = el("div", "cc-msg " + (m.role === "user" ? "me" : "bot") + (m.err ? " err" : ""));
      if (m.pending) w.dataset.pending = "1";
      const body = el("div", "cc-body");
      if (m.role === "user") body.textContent = m.content; else body.innerHTML = md(visible(m.content));
      w.append(body);
      if (m.role === "assistant" && !m.err && !m.pending) {
        if (m.sources?.length) { const s = el("div", "cc-sources"); for (const t of m.sources) s.append(el("span", /^general/i.test(t) ? "gen" : "", t)); w.append(s); }
        const a = el("div", "cc-actions");
        const copy = el("button", "", "Copy"); copy.onclick = async () => { try { await navigator.clipboard.writeText(visible(m.content)); copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1500); } catch {} };
        a.append(copy);
        if (last && conv?.mode !== "practice") { const again = el("button", "", "Try again"); again.onclick = retry; a.append(again); }
        if (m.id) {
          const up = el("button", "cc-thumb" + (m.rating === 1 ? " on" : ""), "👍"), down = el("button", "cc-thumb" + (m.rating === -1 ? " on" : ""), "👎");
          up.title = "Helpful"; down.title = "Not helpful";
          up.onclick = () => rate(m, m.rating === 1 ? 0 : 1);
          down.onclick = () => { if (m.rating === -1) return rate(m, 0); const note = prompt("What was wrong or missing? (optional)") ; if (note !== null) rate(m, -1, note); };
          a.append(up, down);
        }
        if ("speechSynthesis" in window) { const sp = el("button", "", "🔈"); sp.title = "Read out loud"; sp.onclick = () => speak(visible(m.content)); a.append(sp); }
        w.append(a);
      }
      return w;
    }
    async function rate(m, rating, note) {
      try { await call("/coach/rate", { message_id: m.id, rating, note }); m.rating = rating === 0 ? null : rating; render(); } catch {}
    }
    function speak(t) {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t.replace(/[*>#`]/g, "").replace(/\n+/g, ". ")); u.rate = 1.05; speechSynthesis.speak(u);
    }
    function setBusy(on) {
      busy = on; send.innerHTML = on ? "&#9632;" : "&#8593;"; send.setAttribute("aria-label", on ? "Stop" : "Send"); send.classList.toggle("stop", !!on);
    }
    async function ask(text, extra = {}) {
      text = (text ?? "").trim();
      if (busy) return;
      if (!text && !extra.mode) return;
      if (text) msgs.push({ role: "user", content: text });
      const answer = { role: "assistant", content: "", pending: true }; msgs.push(answer);
      box.value = ""; autosize(); render();
      const ctrl = new AbortController(); setBusy(ctrl);
      const body = conv ? { conv_id: conv.conv_id, message: text, ...(extra.retry ? { retry: true } : {}) } : { message: text, ...extra };
      let pendingDraw = false;
      const draw = () => { pendingDraw = false; const b = log.querySelector('.cc-msg[data-pending="1"] .cc-body'); if (b) b.innerHTML = md(visible(answer.content)) || '<span class="cc-dots"><i></i><i></i><i></i></span>'; log.scrollTop = log.scrollHeight; };
      draw();
      try {
        await stream(body, (ev, data) => {
          if (ev === "meta") { const isNew = !conv; conv = data; put("cfn_coach_last", data.conv_id); if (isNew) { if (isPage) history.replaceState(null, "", "#c=" + data.conv_id); loadList(); } $(".cc-title").textContent = data.title; }
          if (ev === "text") { answer.content += data; if (!pendingDraw) { pendingDraw = true; requestAnimationFrame(draw); } }
          if (ev === "done") { Object.assign(answer, { id: data.message_id, content: data.text, sources: data.sources, pending: false }); }
          if (ev === "error") throw new Error(data.error);
        }, ctrl.signal);
      } catch (e) {
        if (e.signin) { signInNote(); setBusy(null); return; }
        if (e.name !== "AbortError") { msgs.pop(); msgs.push({ role: "assistant", content: e.message, err: true }); if (text) box.value = text; }
      }
      answer.pending = false; if (!answer.content && !answer.err) answer.content = "(stopped)";
      setBusy(null); render(); loadList();
      if (get("cfn_coach_speak", "0") === "1" && answer.content && !answer.err) speak(visible(answer.content));
      box.focus();
    }
    function retry() {
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      msgs.splice(msgs.lastIndexOf(lastUser)); ask(lastUser.content, { retry: true }); // the server swaps in the new answer
    }
    function pickPersona() {
      const e = el("div", "cc-msg bot");
      e.innerHTML = '<div class="cc-body"><p><b>Practice a call.</b> Pick who you want to talk to. I\'ll play the client; you run the call. Tap <b>Score my call</b> when you\'re done.</p></div>';
      const chips = el("div", "cc-chips");
      for (const [k, label] of PERSONAS) { const b = el("button", "", label); b.type = "button"; b.onclick = () => { conv = null; msgs = []; render(); ask("", { mode: "practice", persona: k || undefined }); }; chips.append(b); }
      e.append(chips);
      if (msgs.length) { conv = null; msgs = []; render(); }
      log.innerHTML = ""; log.append(e);
    }
    async function scoreCall() {
      if (busy || !conv) return;
      const wait = { role: "assistant", content: "Scoring your call against the CFN checks...", pending: true }; msgs.push(wait); render(); setBusy(new AbortController());
      try { const r = await call("/coach/score", { conv_id: conv.conv_id }); msgs.pop(); msgs.push({ role: "assistant", content: r.text, id: r.message_id }); }
      catch (e) { msgs.pop(); msgs.push({ role: "assistant", content: e.message, err: true }); }
      setBusy(null); render();
    }
    function autosize() { box.style.height = "auto"; box.style.height = Math.min(200, box.scrollHeight) + "px"; }

    $(".cc-form").onsubmit = (e) => { e.preventDefault(); if (busy) { busy.abort(); return; } ask(box.value); };
    box.oninput = autosize;
    box.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) ask(box.value); } };
    if (opts.sidebar) {
      $(".cc-new").onclick = newChat; $(".cc-practice").onclick = () => { newChat(); pickPersona(); };
      $(".cc-menu").onclick = (e) => { e.stopPropagation(); root.classList.toggle("cc-side-open"); };
      $(".cc-main").addEventListener("click", () => root.classList.remove("cc-side-open")); // tap outside the menu closes it
    }
    if (opts.onExpand) $(".cc-expand").onclick = () => opts.onExpand(conv);
    if (!opts.sidebar) $(".cc-newb").onclick = newChat;
    if (opts.onClose) $(".cc-close").onclick = opts.onClose;
    const spk = $(".cc-speak");
    if (!("speechSynthesis" in window)) spk.hidden = true;
    const setSpk = () => { const on = get("cfn_coach_speak", "0") === "1"; spk.setAttribute("aria-pressed", on); spk.classList.toggle("on", on); spk.innerHTML = on ? "&#128266;" : "&#128264;"; };
    spk.onclick = () => { put("cfn_coach_speak", get("cfn_coach_speak", "0") === "1" ? "0" : "1"); if (get("cfn_coach_speak") === "0") speechSynthesis.cancel(); setSpk(); };
    setSpk();
    // Talk instead of type: the browser's own speech recognition, where the phone or browser supports it.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      mic.hidden = false; let rec = null;
      mic.onclick = () => {
        if (rec) { rec.stop(); return; }
        if (get("cfn_coach_mic_ok", "0") !== "1") { alert("Talk to the Coach. Never say a client's SSN, date of birth, or bank or card numbers out loud."); put("cfn_coach_mic_ok", "1"); }
        rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
        const before = box.value ? box.value + " " : "";
        rec.onresult = (ev) => { box.value = before + [...ev.results].map((r) => r[0].transcript).join(""); autosize(); };
        rec.onend = () => { rec = null; mic.classList.remove("on"); if (box.value.trim() && conv?.mode === "practice") ask(box.value); };
        rec.onerror = () => { rec = null; mic.classList.remove("on"); };
        mic.classList.add("on"); rec.start();
      };
    }
    return {
      async init(openId) {
        if (!session) { signInNote(); return; }
        try { start = await call("/coach/start"); } catch (e) { if (e.signin) { signInNote(); return; } }
        // Opened from "Help me save this": start a new chat with that question.
        const ask0 = isPage ? new URLSearchParams(location.search).get("ask") : null;
        if (ask0) { history.replaceState(null, "", location.pathname); conv = null; msgs = []; render(); loadList(); ask(ask0.slice(0, 4000)); return; }
        if (openId) await openChat(openId); else { render(); loadList(); }
      },
      openChat, newChat,
    };
  }
  window.CFNCoach = { mount, md };

  if (isPage) {
    const app = mount(document.getElementById("coach"), { sidebar: true });
    app.init(/^#c=([0-9a-f-]{36})$/i.exec(location.hash)?.[1]);
    return;
  }
  // The bubble on every other page.
  const fab = el("button", "coach-fab"); fab.innerHTML = "<span aria-hidden='true'>&#9992;</span> Coach"; fab.setAttribute("aria-label", "Open the CFN Coach");
  const panel = el("div", "coach-panel cc"); panel.hidden = true;
  document.body.append(fab, panel);
  let app = null;
  const close = () => { panel.hidden = true; fab.hidden = false; };
  fab.onclick = async () => {
    panel.hidden = false; fab.hidden = true;
    if (!app) {
      app = mount(panel, { onClose: close, onExpand: (c) => { location.href = "/coach" + (c ? "#c=" + c.conv_id : ""); } });
      await app.init(get("cfn_coach_last", "") || null);
    }
    panel.querySelector("textarea")?.focus();
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close(); });
})();
