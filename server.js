require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error("MONGODB_URI is missing. Copy .env.example to .env and put your Atlas connection string in it.");
  process.exit(1);
}

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });
let foodsCol, daysCol, settingsCol;

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
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

async function start() {
  try {
    await client.connect();
  } catch (e) {
    console.error("Could not connect to MongoDB: " + e.message);
    console.error("Check: 1) the password in .env, 2) your current IP is allowed in Atlas > Network Access, 3) you are online.");
    process.exit(1);
  }
  try {
    const db = client.db(process.env.MONGODB_DB || "proteinplate");
    foodsCol = db.collection("foods");
    daysCol = db.collection("days");
    settingsCol = db.collection("settings");
    await foodsCol.createIndex({ nameKey: 1 }, { unique: true });
    await importFromFiles();
  } catch (e) {
    console.error("Startup failed: " + e.message);
    process.exit(1);
  }
  // 0.0.0.0 so your phone can reach it over the same Wi-Fi
  app.listen(PORT, "0.0.0.0", () => console.log("Protein Plate running on http://localhost:" + PORT + " (database connected)"));
}
start();