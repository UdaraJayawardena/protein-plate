require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
// ---------- password protection (sign-in page + signed cookie) ----------
const APP_USER = process.env.APP_USER;
const APP_PASSWORD = process.env.APP_PASSWORD;
const AUTH_ON = !!(APP_USER && APP_PASSWORD);
const ONLINE = !!(process.env.RENDER || process.env.VERCEL || process.env.NODE_ENV === "production");
const MISSING_AUTH = ONLINE && !AUTH_ON;
if (MISSING_AUTH) console.error("APP_USER and APP_PASSWORD must be set when the app runs online. Add them as environment variables.");

const COOKIE = "pp_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in for 30 days
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // constant-time comparison
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The cookie is signed with a key made from the username and password,
// so changing either one signs everyone out.
const SESSION_KEY = AUTH_ON
  ? crypto.createHmac("sha256", "protein-plate-session-v1").update(APP_USER + "\n" + APP_PASSWORD).digest()
  : null;
const sign = (exp) => crypto.createHmac("sha256", SESSION_KEY).update("v1." + exp).digest("base64url");
const makeSession = () => { const exp = Date.now() + SESSION_MS; return exp + "." + sign(exp); };

function getCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function validSession(req) {
  if (!AUTH_ON) return true;
  const t = getCookie(req, COOKIE);
  if (!t) return false;
  const i = t.indexOf(".");
  if (i < 1) return false;
  const exp = Number(t.slice(0, i));
  if (!(exp > Date.now())) return false;
  const given = t.slice(i + 1);
  const good = sign(exp);
  return given.length === good.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(good));
}

function cookieHeader(value, maxAgeSeconds, req) {
  const secure = process.env.VERCEL || req.headers["x-forwarded-proto"] === "https";
  return COOKIE + "=" + value + "; Path=/; Max-Age=" + maxAgeSeconds + "; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "");
}

// The sign-in page. It is a string inside this file so that it is always bundled when deployed.
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Sign in - Protein Plate</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4f6f1;--card:#fff;--ink:#16302b;--mute:#5d726c;--line:#d9e1db;--gold:#e9a500;--goldink:#3a2a00;--bad:#b3261e;box-sizing:border-box}
@media (prefers-color-scheme:dark){:root{--bg:#0f1c19;--card:#172a26;--ink:#e8f0ec;--mute:#93aaa3;--line:#27403a;--gold:#f0b429;--goldink:#2a1d00;--bad:#ff8a80}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 "Bricolage Grotesque",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px))}
.box{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 22px}
.logo{width:44px;height:44px;border-radius:50%;border:6px solid var(--gold);margin:0 0 14px;position:relative}
.logo:after{content:"";position:absolute;inset:6px;border-radius:50%;background:var(--gold);opacity:.35}
h1{margin:0;font-size:1.6rem;font-weight:800;letter-spacing:-.02em}
.sub{margin:4px 0 20px;color:var(--mute)}
label{display:block;font-size:.85rem;color:var(--mute);margin:12px 0 4px}
input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid var(--gold);outline-offset:1px}
.pw{position:relative}
.pw input{padding-right:70px}
.eye{position:absolute;right:4px;top:4px;bottom:4px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--mute);font:inherit;font-size:.85rem;cursor:pointer}
.go{width:100%;margin-top:20px;padding:13px;border:0;border-radius:10px;background:var(--gold);color:var(--goldink);font:inherit;font-weight:800;cursor:pointer}
.go:disabled{opacity:.6;cursor:default}
.err{min-height:1.3em;margin:12px 0 0;color:var(--bad);font-size:.9rem}
</style>
</head>
<body>
<main class="box">
  <div class="logo" aria-hidden="true"></div>
  <h1>Protein Plate</h1>
  <p class="sub">Sign in to continue</p>
  <form id="f" autocomplete="on">
    <label for="u">Username</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
    <label for="p">Password</label>
    <div class="pw">
      <input id="p" name="password" type="password" autocomplete="current-password" required>
      <button type="button" class="eye" id="eye" aria-pressed="false">Show</button>
    </div>
    <p class="err" id="err" role="alert"></p>
    <button class="go" id="go" type="submit">Sign in</button>
  </form>
</main>
<script>
var f=document.getElementById("f"),u=document.getElementById("u"),p=document.getElementById("p"),
    err=document.getElementById("err"),go=document.getElementById("go"),eye=document.getElementById("eye");
eye.onclick=function(){var show=p.type==="password";p.type=show?"text":"password";eye.textContent=show?"Hide":"Show";eye.setAttribute("aria-pressed",show)};
f.addEventListener("submit",async function(e){
  e.preventDefault();err.textContent="";go.disabled=true;go.textContent="Signing in...";
  try{
    var r=await fetch("/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u.value,password:p.value})});
    if(r.ok){location.replace("/");return}
    var o={};try{o=await r.json()}catch(x){}
    err.textContent=o.error||"Could not sign in.";p.value="";p.focus();
  }catch(x){err.textContent="Could not reach the server."}
  go.disabled=false;go.textContent="Sign in";
});
</script>
</body>
</html>`;

// ---------- database connection (created on first use, then reused) ----------
// On Vercel the app runs as short-lived functions, so the connection is made lazily and kept
// for as long as the function instance stays warm. Locally it is made once at startup.
let client, foodsCol, daysCol, settingsCol, readyPromise;

async function init() {
  const URI = process.env.MONGODB_URI;
  if (!URI) {
    throw new Error("MONGODB_URI is missing. Put your Atlas connection string in .env (locally) or in the environment variables (online).");
  }
  try {
    client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
    try {
      await client.connect();
    } catch (e) {
      throw new Error("Could not connect to MongoDB: " + e.message + "\nCheck: 1) the password in the connection string, 2) your IP is allowed in Atlas > Network Access, 3) you are online.");
    }
    const db = client.db(process.env.MONGODB_DB || "proteinplate");
    foodsCol = db.collection("foods");
    daysCol = db.collection("days");
    settingsCol = db.collection("settings");
    await foodsCol.createIndex({ nameKey: 1 }, { unique: true });
    try {
      await importFromFiles();
    } catch (e) {
      if (!(e && e.code === 11000)) throw e; // duplicate key: another instance imported at the same moment
    }
  } catch (e) {
    if (client) client.close().catch(() => {});
    client = null;
    throw e;
  }
}

function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

// ---------- validation ----------
const isNum = (v) => typeof v === "number" && isFinite(v) && v >= 0;

function cleanFood(x) {
  if (!x || typeof x.name !== "string" || !x.name.trim() || x.name.length > 100) return null;
  const out = { name: x.name.trim() };
  let any = false;
  for (const k of ["raw", "cooked", "piece"]) {
    const v = x[k];
    if (v === undefined || v === null) continue;
    if (!isNum(v)) return null;
    out[k] = v;
    any = true;
  }
  return any ? out : null;
}

function cleanFoods(body) {
  if (!body || !Array.isArray(body.default) || !Array.isArray(body.custom)) {
    return { error: "Invalid foods data" };
  }
  const seen = new Set();
  const foods = { default: [], custom: [] };
  for (const g of ["default", "custom"]) {
    for (const x of body[g]) {
      const f = cleanFood(x);
      if (!f) return { error: "Invalid food: " + (x && x.name ? x.name : "(no name)") };
      const key = f.name.toLowerCase();
      if (seen.has(key)) return { error: 'A food named "' + f.name + '" already exists.' };
      seen.add(key);
      foods[g].push(f);
    }
  }
  return { foods };
}

function cleanLog(log) {
  if (!log || typeof log !== "object" || Array.isArray(log)) return null;
  const out = {};
  for (const [date, meals] of Object.entries(log)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(meals)) return null;
    out[date] = [];
    for (const m of meals) {
      if (!m || typeof m.n !== "string" || m.n.length > 100 || !isNum(m.g) || !isNum(m.p) ||
          !["raw", "cooked", "piece"].includes(m.s)) return null;
      out[date].push({ n: m.n, g: m.g, s: m.s, p: m.p });
    }
  }
  return out;
}

// ---------- database helpers ----------
const foodDoc = (f, group, order) => ({ nameKey: f.name.toLowerCase(), group, order, ...f });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Replaces the stored foods with the given { default, custom } lists, writing only what changed.
async function saveFoods(foods) {
  const existing = new Map((await foodsCol.find().toArray()).map((d) => [d.nameKey, d]));
  const keep = [];
  const ops = [];
  for (const group of ["default", "custom"]) {
    foods[group].forEach((f, i) => {
      const doc = foodDoc(f, group, i);
      keep.push(doc.nameKey);
      const old = existing.get(doc.nameKey);
      if (old) { const { _id, ...rest } = old; if (same(rest, doc)) return; }
      ops.push({ replaceOne: { filter: { nameKey: doc.nameKey }, replacement: doc, upsert: true } });
    });
  }
  if (ops.length) await foodsCol.bulkWrite(ops);
  await foodsCol.deleteMany({ nameKey: { $nin: keep } });
}

async function loadFoods() {
  const out = { default: [], custom: [] };
  for (const d of await foodsCol.find().sort({ order: 1 }).toArray()) {
    const { _id, nameKey, group, order, ...food } = d;
    (out[group] || out.custom).push(food);
  }
  return out;
}

// Replaces the stored days with the given log, writing only days that changed.
async function saveLog(log, goal) {
  const existing = new Map((await daysCol.find().toArray()).map((d) => [d._id, d.meals]));
  const ops = [];
  for (const [date, meals] of Object.entries(log)) {
    if (meals.length === 0) {
      if (existing.has(date)) ops.push({ deleteOne: { filter: { _id: date } } });
    } else if (!existing.has(date) || !same(existing.get(date), meals)) {
      ops.push({ replaceOne: { filter: { _id: date }, replacement: { _id: date, meals }, upsert: true } });
    }
  }
  for (const date of existing.keys()) {
    if (!(date in log)) ops.push({ deleteOne: { filter: { _id: date } } });
  }
  if (ops.length) await daysCol.bulkWrite(ops);
  await settingsCol.updateOne({ _id: "app" }, { $set: { goal } }, { upsert: true });
}

async function loadLog() {
  const log = {};
  for (const d of await daysCol.find().sort({ _id: 1 }).toArray()) log[d._id] = d.meals;
  const s = await settingsCol.findOne({ _id: "app" });
  return { log, goal: s && s.goal > 0 ? s.goal : 100 };
}

// One-time import of data/foods.json and data/data.json into an empty database.
async function importFromFiles() {
  if (await settingsCol.findOne({ _id: "imported" })) return;
  const dir = path.join(__dirname, "data");
  let did = false;

  const ff = path.join(dir, "foods.json");
  if (fs.existsSync(ff) && (await foodsCol.countDocuments()) === 0) {
    const raw = JSON.parse(fs.readFileSync(ff, "utf8"));
    const r = cleanFoods(Array.isArray(raw) ? { default: raw, custom: [] } : { default: raw.default || [], custom: raw.custom || [] });
    if (r.error) throw new Error("data/foods.json: " + r.error);
    await saveFoods(r.foods);
    console.log("Imported " + (r.foods.default.length + r.foods.custom.length) + " foods from data/foods.json");
    did = true;
  }

  const df = path.join(dir, "data.json");
  if (fs.existsSync(df) && (await daysCol.countDocuments()) === 0) {
    const raw = JSON.parse(fs.readFileSync(df, "utf8"));
    const log = cleanLog(raw.log || {});
    if (!log) throw new Error("data/data.json: the meal log is not in the expected format");
    await saveLog(log, raw.goal > 0 ? raw.goal : 100);
    console.log("Imported " + Object.values(log).filter((m) => m.length).length + " day(s) of meals from data/data.json");
    did = true;
  }

  if (did) await settingsCol.insertOne({ _id: "imported", at: new Date() });
}

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) =>
  MISSING_AUTH ? res.status(503).send("Server is not configured: set APP_USER and APP_PASSWORD.") : next());
app.use(express.json({ limit: "1mb" }));

// ----- sign in / sign out -----
app.post("/auth/login", async (req, res) => {
  if (!AUTH_ON) return res.json({ ok: true });
  const { username, password } = req.body || {};
  const userOk = typeof username === "string" && safeEqual(username.trim(), APP_USER);
  const passOk = typeof password === "string" && safeEqual(password, APP_PASSWORD);
  if (!(userOk && passOk)) {
    await delay(400); // slow down guessing
    return res.status(401).json({ error: "Wrong username or password." });
  }
  res.set("Set-Cookie", cookieHeader(makeSession(), SESSION_MS / 1000, req)).json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  if (!req.is("application/json")) return res.status(400).json({ error: "Bad request" });
  res.set("Set-Cookie", cookieHeader("", 0, req)).json({ ok: true });
});

// ----- the page -----
// The whole front end is one file, sent through Express so it sits behind the sign-in.
// (A "public" folder would be served by Vercel without any sign-in.)
// Locally it is read from static/index.html on every request, so edits show on refresh.
// Online it comes from page.js, a copy made by scripts/build-page.js, because Vercel always
// bundles required modules but can leave loose folders out.
function indexHtml() {
  let html;
  if (!process.env.VERCEL) {
    try {
      html = fs.readFileSync(path.join(__dirname, "static", "index.html"), "utf8");
    } catch (e) { /* fall back to page.js */ }
  }
  if (!html) html = require("./page.js");
  // tells the page that sign-in is on, so it can show the "Log out" button
  return AUTH_ON ? html.replace("</head>", '<meta name="pp-auth" content="1">\n</head>') : html;
}
app.get(["/", "/index.html"], (req, res) => {
  res.set("Cache-Control", "no-store").type("html").send(validSession(req) ? indexHtml() : LOGIN_HTML);
});

// ----- the API: needs a valid session, then the database -----
app.use("/api", (req, res, next) =>
  validSession(req) ? next() : res.status(401).json({ error: "Login required" }));

app.use("/api", async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: "Database error: " + e.message });
  });

app.get("/api/data", wrap(async (req, res) => res.json(await loadLog())));

app.put("/api/data", wrap(async (req, res) => {
  const log = cleanLog(req.body && req.body.log);
  const goal = req.body && req.body.goal;
  if (!log || !(goal > 0)) return res.status(400).json({ error: "Invalid data" });
  await saveLog(log, goal);
  res.json({ ok: true });
}));

app.get("/api/foods", wrap(async (req, res) => res.json(await loadFoods())));

app.put("/api/foods", wrap(async (req, res) => {
  const r = cleanFoods(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  await saveFoods(r.foods);
  res.json({ ok: true, foods: r.foods });
}));

// Anything that throws is written to the log (visible in Vercel's logs) instead of failing silently.
app.use((err, req, res, next) => {
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).send("Internal Server Error. The details are in the server logs.");
});

// Local use: `npm start`. On Vercel the app is exported below and Vercel runs it, so no listen() there.
async function start() {
  if (MISSING_AUTH) process.exit(1);
  try {
    await ready();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  // 0.0.0.0 so your phone can reach it over the same Wi-Fi
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Protein Plate running on http://localhost:" + PORT + " (database connected)");
    console.log(AUTH_ON ? "Password protection: ON (sign-in page)" : "Password protection: OFF (set APP_USER and APP_PASSWORD in .env to turn it on)");
  });
}

if (require.main === module) start();
module.exports = app;