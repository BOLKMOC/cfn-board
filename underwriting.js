// Underwriting math for the Underwriting page: which accounts go in, the enrolled debt, and the program to quote (always the longest
// for the enrolled debt). Also reads a credit pull's text (pasted, or pulled out of the PDF in the browser) into account rows.
// Pure functions only: no network, nothing saved. Rules come from config/underwriting.json.

const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const cents = (n) => Math.round(Number(n) * 100) / 100;

// The program for an enrolled debt: the band it falls in, quoted at the band's longest length. Null under the minimum.
export function programLength(total, rules) {
  const t = cents(total);
  if (!(t >= rules.min_enrolled)) return null;
  const band = rules.bands.find((b) => t >= b.from && (b.to === null || t <= b.to));
  return band ? { months: band.max_months, band } : null;
}

function creditorRule(name, rules) {
  const n = norm(name);
  const ex = rules.excluded_creditors.find((e) => n.includes(norm(e.match)));
  if (ex) return { out: ex.reason };
  const list = (rules.creditor_list?.accepted ?? []).map(norm).filter(Boolean);
  if (list.length && n && !list.some((a) => n.includes(a) || a.includes(n))) return { check: "Not on Cordoba's creditor list: check with a manager before enrolling it." };
  return {};
}

// accounts: [{ id, creditor, balance, type, au, joint, aside, payment }]. Returns each row's verdict, the totals, and the program.
export function checkAccounts(accounts, rules) {
  const rows = accounts.map((a) => {
    const balance = cents(a.balance) || 0, type = rules.types[a.type] ? a.type : "other", t = rules.types[type];
    const r = { ...a, balance, type, status: "in", reason: "", notes: [] };
    const cr = creditorRule(a.creditor, rules);
    if (!(balance > 0)) Object.assign(r, { status: "out", reason: "No balance." });
    else if (!t.ok) Object.assign(r, { status: "out", reason: t.reason });
    else if (a.au) Object.assign(r, { status: "out", reason: "Authorized user only: not the client's debt to settle." });
    else if (cr.out) Object.assign(r, { status: "out", reason: cr.out });
    else if (cr.check) Object.assign(r, { status: "check", reason: cr.check });
    else if (a.aside) Object.assign(r, { status: "aside", reason: "Set aside by the rep." });
    if (r.status === "in" && a.joint) r.notes.push("Joint: the co-signer must be on the program too.");
    if (r.status === "in" && t.note) r.notes.push(t.note);
    return r;
  });
  const sum = (xs) => cents(xs.reduce((s, x) => s + x.balance, 0));
  const inRows = () => rows.filter((r) => r.status === "in");
  // Repo balances come in only while they are half or less of the enrolled debt.
  const repo = sum(inRows().filter((r) => r.type === "repo")), all = sum(inRows());
  if (repo > 0 && repo > rules.repo_max_share * all) for (const r of inRows()) if (r.type === "repo") Object.assign(r, { status: "out", reason: `Repo balances ($${repo.toLocaleString("en-US")}) are over half of the enrolled debt.` });
  const enrolled = sum(inRows()), program = programLength(enrolled, rules);
  const asideN = rows.filter((r) => r.status === "aside").length;
  const payments = cents(inRows().reduce((s, r) => s + (Number(r.payment) || 0), 0));
  const warnings = [];
  if (asideN > rules.max_set_aside) warnings.push(`${asideN} accounts set aside. The rule is two at most.`);
  if (rows.some((r) => r.status === "in" && r.joint)) warnings.push("A joint account is in: get the co-signer on the program.");
  if (rows.some((r) => r.status === "check")) warnings.push("An account is not on Cordoba's creditor list: a manager decides before it goes in.");
  // If the client can't afford it: remove a credit card, smallest first, within the two allowed. Never a shorter program.
  const pullCard = [];
  let left = enrolled;
  for (const c of inRows().filter((r) => r.type === "credit_card").sort((a, b) => a.balance - b.balance).slice(0, Math.max(0, rules.max_set_aside - asideN))) {
    left = cents(left - c.balance);
    const p = programLength(left, rules);
    pullCard.push({ id: c.id, creditor: c.creditor, balance: c.balance, total: left, months: p?.months ?? null, qualifies: !!p });
    if (!p) break;
  }
  return { rows, enrolled, program, months: program?.months ?? null, qualifies: !!program, payments, aside: asideN, warnings, pullCard };
}

const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d+\.\d{2}\b/g;
const amount = (s) => Number(String(s).replace(/[$,\s]/g, ""));
const KIND = [
  ["mortgage", /MORTGAGE|HOME EQUITY|HELOC|REAL ESTATE/],
  ["student", /STUDENT|NAVIENT|NELNET|SALLIE MAE|DEPT OF ED|MOHELA|AIDVANTAGE|EDFINANCIAL/],
  ["repo", /\bREPO/], // before auto: a repo deficiency after a car is taken back is a repo balance
  ["auto", /\bAUTO\b|VEHICLE|CAR LOAN|MOTOR/],
  ["secured", /\bSECURED\b/],
  ["military", /\bAAFES\b|EXCHANGE CREDIT|MILITARY/],
  ["collection", /COLLECTION|PORTFOLIO RECOVERY|MIDLAND|\bLVNV\b|CAVALRY|JEFFERSON CAPITAL/],
  ["medical", /MEDICAL|HOSPITAL|HEALTH/],
  ["personal_loan", /\bLOAN\b|INSTALLMENT|LENDING|UPSTART|ONEMAIN|\bAVANT\b|BEST EGG|PROSPER/],
];
const SKIP = /\bTOTALS?\b|SUMMARY|SCORE|INQUIR|SSN|SOCIAL SECURITY|DATE OF BIRTH|\bDOB\b|ADDRESS|EMPLOYER|PHONE/;

// CIC Credit (TransUnion "InFile") reports, the pull CFN uses: each account is two lines, then notes.
//   "J  B CREDITOR NAME  08/26  05/25  $29648  $24930  $0  15  0  0  0  AS AGREED"   whose, ECOA, creditor, reported, opened, high credit, balance, past due, ..., status
//   "29770155  08/26  AUTO  72 $557  TU"                                                account, last activity, type, terms (months and payment, or MIN $), source
//   "PLACED FOR COLLECTION; ORIGINAL CREDITOR: MEDICAL"                                 (collections)
const TRADE = /^([A-Z])\s+([A-Z])\s+(.+?)\s+(?:\d\d\/\d\d|--\/--)\s+(?:\d\d\/\d\d|--\/--)\s+\$(\d+)\s+\$(\d+)\s+\$(\d+)\b(.*)$/;
const TRADE2 = /^\S+\s+(?:\d\d\/\d\d|--\/--)\s+([A-Z]+)\b(.*)$/;
const CIC_TYPE = { AUTO: "auto", MTG: "mortgage", EDU: "student", REV: "credit_card", INST: "personal_loan", COLL: "collection", OPEN: "other" };

export function parseTradelines(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const out = [];
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = TRADE.exec(lines[i]);
    if (!m) continue;
    seen++;
    const [, whose, ecoa, name, , bal] = m, balance = Number(bal);
    const m2 = TRADE2.exec(lines[i + 1] ?? "");
    const code = m2?.[1] ?? "", terms = m2?.[2] ?? "";
    const pay = /\$(\d+)/.exec(terms);
    const note = /ORIGINAL CREDITOR:\s*(?:\d+\s+)?(.+)$/.exec((lines[i + 2] ?? "").toUpperCase());
    if (!(balance > 0)) continue;
    let type = CIC_TYPE[code] ?? "other";
    if (type === "collection" && note && /MEDICAL/.test(note[1])) type = "medical";
    if (type === "personal_loan" && /\bSECURED\b/.test(name.toUpperCase())) type = "secured";
    const codes = [whose, ecoa];
    out.push({
      creditor: (name + (note && !/MEDICAL/.test(note[1]) ? ` (orig. ${note[1].trim()})` : "")).slice(0, 60), balance,
      payment: pay && Number(pay[1]) > 0 ? Number(pay[1]) : null, type,
      au: codes.includes("A"), joint: codes.some((c) => c === "J" || c === "C" || c === "S"), aside: false,
    });
  }
  return seen ? out : null; // null: not this layout
}

// Reads credit pull text into account rows. A CIC Credit report is read by its own layout; anything else
// one row per line that has a creditor name and a dollar amount.
// The balance is the amount after "balance" when the line labels it, else the first amount; a payment after "payment" or "monthly".
// Zero balances and summary lines are skipped. The rep checks every row.
export function parsePull(text) {
  const cic = parseTradelines(text);
  if (cic) return cic;
  const out = [];
  let cols = null; // money columns named by the last header line (e.g. "Creditor Type Balance Payment"), in order
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim(), up = line.toUpperCase();
    if (!line || SKIP.test(up)) continue;
    const amounts = [...line.matchAll(MONEY)];
    if (!amounts.length) {
      const named = [...up.matchAll(/\b(BALANCE|PAYMENT|MONTHLY|LIMIT|HIGH CREDIT|PAST DUE)\b/g)].map((m) => m[1]);
      if (named.includes("BALANCE")) cols = named.map((n) => (n === "MONTHLY" ? "PAYMENT" : n));
      continue;
    }
    const name = line.slice(0, amounts[0].index).replace(/\b(balance|bal|payment|pmt|monthly|limit|high credit|acct|account)\b.*$/i, "").replace(/[^A-Za-z0-9&'/ .\-]/g, " ").replace(/\b(revolving|installment|open|closed|individual|joint|authori[zs]ed user|collection|charge ?off|derogatory)\b/gi, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim().replace(/[ .\-]+$/, "");
    if (!/[A-Za-z]{2,}/.test(name)) continue;
    const after = (re) => { const m = re.exec(line); if (!m) return null; const a = [...line.slice(m.index).matchAll(MONEY)][0]; return a ? amount(a[0]) : null; };
    const byCol = (name) => { const i = cols?.indexOf(name) ?? -1; return i >= 0 && i < amounts.length && amounts.length <= cols.length ? amount(amounts[i][0]) : null; };
    const balance = after(/\bbal(ance)?\b/i) ?? byCol("BALANCE") ?? amount(amounts[0][0]);
    if (!(balance > 0)) continue;
    const payment = after(/\b(payment|pmt|monthly)\b/i) ?? byCol("PAYMENT");
    out.push({
      creditor: name.slice(0, 60), balance, payment: payment && payment !== balance ? payment : null,
      type: (KIND.find(([, re]) => re.test(up)) ?? ["credit_card"])[0],
      au: /AUTHORI[ZS]ED USER|\bAU\b/.test(up), joint: /\bJOINT\b/.test(up), aside: false,
    });
  }
  return out;
}

// Lines of text from pdf.js text items: items on the same row (same y, within 2 points) joined left to right.
export function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    const s = String(it.str ?? "");
    if (!s.trim()) continue;
    const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0;
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push(row = { y, parts: [] });
    row.parts.push({ x, s });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join("  ")).join("\n");
}
