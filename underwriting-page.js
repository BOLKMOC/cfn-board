// The Underwriting page: reads a credit pull (PDF or pasted text) on this device, lets the rep check each account, and shows
// the program to quote (always the longest for the enrolled debt). Nothing is sent or saved: the accounts live only in this tab.
import { checkAccounts, linesFromItems, parsePull } from "./underwriting.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
let rules = null, accounts = [], nextId = 1;

let session = null;
try { session = localStorage.getItem("cfn_session"); } catch { /* storage blocked: treated as signed out */ }
if (!session) $("gate").hidden = false;
else start();

async function start() {
  try { rules = await (await fetch("underwriting.json", { cache: "no-store" })).json(); }
  catch { $("gate").hidden = false; $("gate").innerHTML = '<p style="margin:0">The underwriting rules did not load. Refresh the page.</p>'; return; }
  $("app").hidden = false;
  $("bands").innerHTML = rules.bands.map((b) => `<tr data-from="${b.from}"><td>${money(b.from)}${b.to === null ? " and up" : " to " + money(b.to)}</td><td><b>${b.max_months} months</b></td></tr>`).join("");
  $("ruleNote").textContent = `Under ${money(rules.min_enrolled)} enrolled does not qualify. Out: secured, auto, title, mortgage and home equity, home improvement and solar, student loans, military, IRS, utilities, insurance, leases and rent to own, authorized-user accounts, debts under $${rules.min_account}, and under $${rules.min_per_creditor} per creditor. Repo, medical, back rent, and business debt together: half or less of the enrolled debt.`;
  $("listDate").textContent = `Cordoba list of ${new Date(rules.cordoba_list_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  $("exN").textContent = rules.excluded_creditors.length + (rules.secured_only_creditors?.length ? ` plus ${rules.secured_only_creditors.length} secured-only` : "");
  $("exList").innerHTML = rules.excluded_creditors.map((e) => esc(e.name)).sort((a, b) => a.localeCompare(b)).join(" · ")
    + (rules.secured_only_creditors?.length ? `<br><b>Secured loans only:</b> ${rules.secured_only_creditors.map((e) => esc(e.name)).join(" · ")}` : "");
  $("reqList").innerHTML = (rules.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join("");
  const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP".split(" ");
  $("state").insertAdjacentHTML("beforeend", STATES.map((s) => `<option>${s}</option>`).join(""));
  $("state").onchange = update;
  $("pdf").onchange = readPdf;
  $("pick").onclick = () => $("pdf").click();
  $("readPaste").onclick = () => { add(parsePull($("paste").value), "the pasted text"); $("paste").value = ""; };
  $("addRow").onclick = () => { accounts.push(blank()); drawAccounts(); const c = document.querySelectorAll(".acct .cr input"); c[c.length - 1]?.focus(); };
  $("clear").onclick = () => { accounts = []; $("state").value = ""; $("paste").value = ""; $("pdf").value = ""; $("pdfMsg").textContent = ""; drawAccounts(); };
  drawAccounts();
}

const blank = () => ({ id: nextId++, creditor: "", balance: "", type: "credit_card", au: false, joint: false, aside: false, payment: null });

function add(rows, from) {
  if (!rows.length) { $("pdfMsg").textContent = `No accounts found in ${from}. Paste the accounts part of the report, or add them by hand.`; return; }
  accounts.push(...rows.map((r) => ({ ...r, id: nextId++ })));
  $("pdfMsg").textContent = `${rows.length} account${rows.length === 1 ? "" : "s"} read from ${from}. Check each one below.`;
  drawAccounts();
}

async function readPdf() {
  const file = $("pdf").files?.[0];
  if (!file) return;
  $("pdfMsg").textContent = "Reading the PDF on this device...";
  try {
    const pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, 40); p++) lines.push(linesFromItems((await (await doc.getPage(p)).getTextContent()).items));
    await doc.destroy();
    const text = lines.join("\n");
    if (text.replace(/\s/g, "").length < 40) { $("pdfMsg").textContent = "Can't read this PDF (it looks like a scanned picture). Paste the text instead, or add the accounts by hand."; return; }
    add(parsePull(text), "the PDF");
  } catch {
    $("pdfMsg").textContent = "Can't read this PDF. Paste the text instead, or add the accounts by hand.";
  } finally { $("pdf").value = ""; }
}

function drawAccounts() {
  $("acctCard").hidden = !accounts.length;
  const types = Object.entries(rules.types).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("");
  $("accts").innerHTML = accounts.map((a) => `<div class="acct" data-id="${a.id}">
      <label class="cr"><input class="f" data-k="creditor" value="${esc(a.creditor)}" placeholder="Creditor" aria-label="Creditor" maxlength="60"></label>
      <label><input class="f" data-k="balance" value="${esc(a.balance)}" inputmode="decimal" placeholder="Balance" aria-label="Balance"></label>
      <label><select class="f" data-k="type" aria-label="Type">${types}</select></label>
      <button class="link" data-del aria-label="Remove this row">Remove</button>
      <div class="flags"><label><input type="checkbox" data-k="au"${a.au ? " checked" : ""}> Authorized user only</label><label><input type="checkbox" data-k="joint"${a.joint ? " checked" : ""}> Joint</label><label><input type="checkbox" data-k="aside"${a.aside ? " checked" : ""}> Set aside</label>${a.payment ? `<span>Payment on the pull: ${money(a.payment)}/mo</span>` : ""}</div>
      <div class="verdict"></div></div>`).join("");
  for (const el of $("accts").querySelectorAll(".acct")) {
    const a = accounts.find((x) => x.id === Number(el.dataset.id));
    el.querySelector("select").value = a.type;
    el.oninput = el.onchange = (e) => {
      const k = e.target.dataset?.k; if (!k) return;
      a[k] = e.target.type === "checkbox" ? e.target.checked : k === "balance" ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value;
      update();
    };
    el.querySelector("[data-del]").onclick = () => { accounts = accounts.filter((x) => x !== a); drawAccounts(); };
  }
  update();
}

function update() {
  const r = checkAccounts(accounts.map((a) => ({ ...a, balance: Number(a.balance) || 0 })), rules, { state: $("state").value });
  const LABEL = { in: "In", out: "Out", aside: "Set aside", check: "Ask a manager" };
  for (const row of r.rows) {
    const el = document.querySelector(`.acct[data-id="${row.id}"]`); if (!el) continue;
    el.className = "acct " + row.status;
    el.querySelector(".verdict").innerHTML = `<span class="pill ${row.status}">${LABEL[row.status]}</span>${esc(row.reason)}${row.notes.map((n) => ` <span class="note">${esc(n)}</span>`).join("")}`;
  }
  const inN = r.rows.filter((x) => x.status === "in").length;
  $("acctN").textContent = accounts.length ? `${inN} of ${accounts.length} in` : "";
  for (const tr of $("bands").querySelectorAll("tr")) tr.classList.toggle("on", !!r.program && Number(tr.dataset.from) === r.program.band.from);
  $("resCard").hidden = !accounts.length;
  if (!accounts.length) return;
  const head = r.qualifies
    ? `<div class="note">Quote the longest program</div><div class="big">${r.months} months</div>`
    : `<div class="dq">Does not qualify</div><div class="note">${r.underMin ? `${r.enrolled ? `Enrolled debt is ${money(r.enrolled)}. ` : ""}The minimum is ${money(rules.min_enrolled)} of enrollable debt.` : "See the reason below."}</div>`;
  const pull = r.qualifies && r.pullCard.length ? `<p class="label" style="margin-top:14px"><span>If they can't afford the payment</span></p>
      <p class="note" style="margin:0 0 6px">Remove a credit card, smallest first, two at most. The program stays the longest for the new total. Never quote a shorter length.</p>
      ${r.pullCard.map((p, i) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--tint);font-size:14px"><span>${i + 1}. Set aside <b>${esc(p.creditor || "this card")}</b> (${money(p.balance)}): ${p.qualifies ? `enrolled ${money(p.total)}, <b>${p.months} months</b>${p.months !== r.months && i === 0 ? ` (was ${r.months})` : ""}` : `<span class="warn">drops under ${money(rules.min_enrolled)}: can't</span>`}</span>${p.qualifies && i === 0 ? `<button class="go small ghost" data-aside="${p.id}">Set aside</button>` : ""}</div>`).join("")}` : "";
  $("result").innerHTML = head + `<div class="res">
      <div class="mini"><div class="k">Enrolled debt</div><div class="v">${money(r.enrolled)}</div></div>
      <div class="mini"><div class="k">Accounts in</div><div class="v">${inN}</div></div>
      <div class="mini"><div class="k">They pay now on these</div><div class="v">${r.payments ? money(r.payments) : "-"}</div></div></div>
      ${r.payments ? "" : '<p class="note" style="margin:0">Ask what they pay each month on these; the minimum payment pitch is built on it.</p>'}
      ${r.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join("")}
      ${r.qualifies ? `<p class="note" style="margin:8px 0 0">Build the price in Forth at ${r.months} months. Deposits can't come from a bank the client owes on an enrolled account.</p>` : ""}
      ${pull}`;
  const btn = $("result").querySelector("[data-aside]");
  if (btn) btn.onclick = () => { const a = accounts.find((x) => x.id === Number(btn.dataset.aside)); if (a) { a.aside = true; drawAccounts(); } };
}
