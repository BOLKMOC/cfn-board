// CFN Sales Coach chat panel. Shown on every page for signed-in closers and managers (not in TV mode).
// Coaching only: it never contacts clients. The conversation stays in this browser tab and is logged on the server.
(() => {
  let session = null;
  try { session = localStorage.getItem("cfn_session"); } catch {}
  if (!session || document.body.classList.contains("tv") || /[?&]tv=1/.test(location.search) || /tv=1/.test(location.hash)) return;
  const KEY = "cfn_coach";
  let msgs = [];
  try { msgs = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-20))); } catch {} };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const fab = el("button", "coach-fab"); fab.innerHTML = "<span aria-hidden='true'>&#9992;</span> Coach"; fab.setAttribute("aria-label", "Open the CFN Sales Coach");
  const panel = el("section", "coach-panel"); panel.hidden = true; panel.setAttribute("aria-label", "CFN Sales Coach");
  panel.innerHTML = `<div class="coach-head"><div><b>CFN Coach</b><small>Call flow, rebuttals, role-play, your pipeline</small></div><button aria-label="Close">&times;</button></div>
    <div class="coach-log" aria-live="polite"></div>
    <div class="coach-chips"></div>
    <form class="coach-form"><textarea rows="2" maxlength="4000" placeholder="Ask anything, or paste what the client just said"></textarea><button type="submit">Send</button></form>
    <div class="coach-foot">Coaching only: it can't contact clients. Never paste SSNs or bank numbers. Chats are logged.</div>`;
  document.body.append(fab, panel);
  const log = panel.querySelector(".coach-log"), form = panel.querySelector("form"), box = form.querySelector("textarea"), send = form.querySelector("button");
  const chips = ["Client says: I need to talk to my wife", "Role-play a skeptical client with me", "How do I save my pending cancels?", "How do I get the 1st payment within 7 days?", "Walk me through the anchor"];
  for (const c of chips) { const b = el("button", "", c); b.type = "button"; b.onclick = () => ask(c); panel.querySelector(".coach-chips").append(b); }

  function render() {
    log.innerHTML = "";
    if (!msgs.length) log.append(el("div", "coach-msg bot", "Hey, I'm your CFN Coach. Ask me what to say, practice a call with me, or ask about your pending cancels."));
    for (const m of msgs) log.append(el("div", "coach-msg " + (m.role === "user" ? "me" : m.err ? "bot err" : "bot"), m.content));
    log.scrollTop = log.scrollHeight;
  }
  async function ask(text) {
    text = text.trim(); if (!text || send.disabled) return;
    msgs = msgs.filter((m) => !m.err);
    msgs.push({ role: "user", content: text }); box.value = ""; render(); save();
    send.disabled = true; const typing = el("div", "coach-msg bot", "Thinking..."); log.append(typing); log.scrollTop = log.scrollHeight;
    try {
      const r = await fetch(window.BOARD_API + "/coach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session },
        body: JSON.stringify({ messages: msgs.map(({ role, content }) => ({ role, content })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The coach is not answering right now.");
      msgs.push({ role: "assistant", content: j.reply });
    } catch (e) {
      msgs.pop(); // let them resend the same question
      msgs.push({ role: "assistant", content: e.message, err: true }); box.value = text;
    }
    send.disabled = false; render(); save(); box.focus();
  }
  form.onsubmit = (e) => { e.preventDefault(); ask(box.value); };
  box.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(box.value); } };
  fab.onclick = () => { panel.hidden = false; fab.hidden = true; render(); box.focus(); };
  panel.querySelector(".coach-head button").onclick = () => { panel.hidden = true; fab.hidden = false; };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; fab.hidden = false; } });
})();
