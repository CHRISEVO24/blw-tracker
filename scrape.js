#!/usr/bin/env node
/**
 * Birmingham Luxury Watches — Inventory Scraper v1
 *
 * Fetches all products across 21 brand collections via Shopify's
 * /collections/{slug}/products.json endpoint. No page scraping needed —
 * all data (title, price, vendor, images) comes from the JSON API.
 *
 * Usage: node scrape.js
 */

const https   = require("https");
const fs      = require("fs");
const path    = require("path");

const HISTORY_FILE = path.join(__dirname, "history.json");
const DELAY_MS     = 200;

const COLLECTIONS = [
  "bell-ross-watches",
  "blacpain-watches",
  "breitling-watches",
  "bremont-watches",
  "bulgari-watches",
  "cartier",
  "chopard-watches",
  "girard-perregaux-watches",
  "hublot-watches",
  "iwc-watches",
  "jaeger-lecoultre-watches",
  "omega-watches",
  "panerai-watches",
  "patek-philippe-watches",
  "rolex-watches",
  "seiko-grand-seiko",
  "tag-heuer-watches",
  "tudor-watches",
  "vacheron-constantin-watches",
  "vintage-watches",
  "zenith-watches",
];

const BASE = "https://birminghamluxurywatches.com";

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "BLWTracker/1.0",
        "Accept": "application/json",
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`Parse error at ${url}: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout: " + url)); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch all products from one collection (paginated) ────────────────────────

async function fetchCollection(slug) {
  const products = [];
  let page = 1;

  while (true) {
    const url = `${BASE}/collections/${slug}/products.json?limit=250&page=${page}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      console.log(`    ⚠️  ${slug} page ${page}: ${e.message}`);
      break;
    }

    const batch = data.products || [];
    if (batch.length === 0) break;

    products.push(...batch);
    if (batch.length < 250) break; // last page
    page++;
    await sleep(DELAY_MS);
  }

  return products;
}

// ── Normalise a Shopify product → lean record ─────────────────────────────────

function buildRecord(product, collectionSlug) {
  const variant  = product.variants?.[0] || {};
  const priceRaw = parseFloat(variant.price || "0");
  const price    = priceRaw > 0 ? Math.round(priceRaw) : null;

  // Derive brand: prefer vendor field, fall back to collection slug
  const brand = (product.vendor || "")
    .replace(/\bwatches?\b/i, "")
    .trim() || slugToBrand(collectionSlug);

  return {
    id:          String(product.id),
    title:       product.title || "",
    brand:       brand,
    price:       price,
    available:   variant.available !== false,
    url:         `${BASE}/products/${product.handle}`,
    image:       product.images?.[0]?.src || "",
    tags:        (product.tags || []).join(", "),
    collection:  collectionSlug,
    updatedAt:   product.updated_at || "",
  };
}

function slugToBrand(slug) {
  return slug
    .replace(/-watches$/, "")
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── History I/O ───────────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); }
  catch { return {}; }
}

function saveHistory(h) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h));
}

function trimHistory(history) {
  const keys = Object.keys(history).sort();
  const keep = keys.slice(-20);
  const trimmed = {};
  for (const k of keep) trimmed[k] = history[k];
  const removed = keys.length - keep.length;
  if (removed > 0) console.log(`  Trimmed ${removed} old snapshot(s), keeping ${keep.length}`);
  return trimmed;
}

function nowKey() {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).replace("T", " ").slice(0, 16);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const key     = nowKey();
  const history = loadHistory();

  console.log(`\nBirmingham Luxury Watches — Inventory Snapshot`);
  console.log(`Timestamp : ${key} ET`);
  console.log(`Collections: ${COLLECTIONS.length}\n`);

  const seen    = new Set(); // dedupe across collections
  const snapshot = {};
  let total = 0;

  for (const slug of COLLECTIONS) {
    process.stdout.write(`  ${slug.padEnd(35)}`);
    const products = await fetchCollection(slug);

    let added = 0;
    for (const p of products) {
      const id = String(p.id);
      if (seen.has(id)) continue; // product appears in multiple collections
      seen.add(id);
      snapshot[id] = buildRecord(p, slug);
      added++;
    }

    console.log(`${added} products`);
    total += added;
    await sleep(DELAY_MS);
  }

  console.log(`\n  Total unique products: ${total}`);

  history[key] = snapshot;
  const trimmed = trimHistory(history);
  saveHistory(trimmed);

  console.log(`  Snapshot saved: ${key}`);
  console.log(`  History snapshots: ${Object.keys(trimmed).length}\n`);
}

main().catch(e => { console.error("\nFatal:", e.message); process.exit(1); });
