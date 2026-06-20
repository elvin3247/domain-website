// /api/check?domain=example.com           -> { state, provider? }
// /api/check?domains=a.com,b.com,c.com     -> { results: [ {state,provider?}, ... ] }
//
// state: "available" | "forsale" | "taken" | "unknown"
//
// Availability comes from DNS-over-HTTPS (Google, then Cloudflare) run server-side
// and in parallel for the whole batch. NXDOMAIN = available; nameservers present =
// registered (parked marketplaces -> "forsale", otherwise "taken"); ambiguous is
// confirmed with an SOA lookup. No API key needed. Set the NAMECHEAP_* env vars to
// override availability with Namecheap's official check (see README).

const PARKING = [
  { k: "sedoparking", n: "Sedo" }, { k: "sedo.com", n: "Sedo" },
  { k: "parkingcrew", n: "ParkingCrew" }, { k: "dan.com", n: "Dan" },
  { k: "undeveloped.com", n: "Dan" }, { k: "afternic", n: "Afternic" },
  { k: "bodis.com", n: "Bodis" }, { k: "above.com", n: "Above" },
  { k: "uniregistry", n: "Uniregistry" }, { k: "hugedomains", n: "HugeDomains" },
  { k: "fabulous.com", n: "Fabulous" }, { k: "cashparking", n: "GoDaddy" },
  { k: "parklogic", n: "ParkLogic" }, { k: "smartname", n: "SmartName" },
  { k: "voodoo.com", n: "DropCatch" }, { k: "sav.com", n: "Sav" },
  { k: "domainmarket", n: "DomainMarket" }, { k: "brandbucket", n: "BrandBucket" },
  { k: "snparking", n: "SnapNames" }, { k: "name-services.com", n: "parking" }
];
const enc = encodeURIComponent;

async function fetchT(url, ms, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { headers: headers || { accept: "application/dns-json" }, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// DNS-over-HTTPS query (Google primary, Cloudflare fallback)
async function dohQuery(domain, type) {
  const urls = [
    "https://dns.google/resolve?name=" + enc(domain) + "&type=" + type,
    "https://cloudflare-dns.com/dns-query?name=" + enc(domain) + "&type=" + type
  ];
  for (const u of urls) {
    try {
      const r = await fetchT(u, 4500);
      if (r.ok) return await r.json();
    } catch (e) { /* try next resolver */ }
  }
  return null;
}

function classify(nsHosts) {
  const hosts = (nsHosts || []).map(h => (h || "").toLowerCase());
  for (const p of PARKING) {
    if (hosts.some(h => h.includes(p.k))) return { state: "forsale", provider: p.n };
  }
  return { state: "taken" };
}

async function checkDomain(domain) {
  const ns = await dohQuery(domain, "NS");
  if (!ns) return { state: "unknown" };                    // both resolvers failed
  if (ns.Status === 3) return { state: "available" };      // NXDOMAIN = unregistered
  if (ns.Status === 0) {
    const hosts = []
      .concat((ns.Answer || []).filter(a => a.type === 2).map(a => a.data || ""))
      .concat((ns.Authority || []).filter(a => a.type === 2).map(a => a.data || ""));
    if (hosts.length) return classify(hosts);
    // no NS records — confirm registration with an SOA lookup before trusting "open"
    const soa = await dohQuery(domain, "SOA");
    if (!soa) return { state: "unknown" };
    if (soa.Status === 3) return { state: "available" };
    if (soa.Status === 0 && (soa.Answer || []).some(a => a.type === 6)) return { state: "taken" };
    return { state: "unknown" };
  }
  return { state: "unknown" };
}

// Authoritative registry double-check via RDAP. Used only to confirm domains that
// DNS reported as "available", catching registered-but-undelegated false positives.
async function rdapConfirm(domain) {
  try {
    const r = await fetchT("https://rdap.org/domain/" + enc(domain), 6000, { accept: "application/rdap+json" });
    if (r.status === 404) return { state: "available" };          // registry has no record -> truly open
    if (r.status >= 200 && r.status < 300) {
      const j = await r.json().catch(() => null);
      const ns = (j && Array.isArray(j.nameservers) ? j.nameservers : []).map(n => (n.ldhName || "").toLowerCase());
      return classify(ns);                                        // registered -> taken / forsale
    }
    return { state: "available" };                                // couldn't determine -> leave as-is
  } catch (e) {
    return { state: "available" };
  }
}

// server-side concurrency limiter
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

// optional Namecheap official availability (batch). Returns { domain: true|false }.
async function namecheapMap(list) {
  const u = process.env.NAMECHEAP_API_USER, k = process.env.NAMECHEAP_API_KEY,
        n = process.env.NAMECHEAP_USERNAME, ip = process.env.NAMECHEAP_CLIENT_IP;
  if (!u || !k || !n || !ip) return null;
  try {
    const url = "https://api.namecheap.com/xml.response?ApiUser=" + enc(u) + "&ApiKey=" + enc(k)
      + "&UserName=" + enc(n) + "&ClientIp=" + enc(ip)
      + "&Command=namecheap.domains.check&DomainList=" + enc(list.join(","));
    const r = await fetchT(url, 6000);
    if (!r.ok) return null;
    const xml = await r.text();
    const map = {};
    const tags = xml.match(/<DomainCheckResult\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const d = (tag.match(/Domain="([^"]+)"/i) || [])[1];
      const a = (tag.match(/Available="(true|false)"/i) || [])[1];
      if (d && a) map[d.toLowerCase()] = a.toLowerCase() === "true";
    }
    return map;
  } catch (e) { return null; }
}

function sanitize(d) { return String(d || "").trim().toLowerCase(); }
const valid = d => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 80;

// Porkbun public price list (no auth) -> base registration price per TLD we support.
// Cached in-memory per warm instance; the response also carries a long edge-cache header.
let _priceCache = null, _priceTs = 0;
async function porkbunPrices() {
  if (_priceCache && Date.now() - _priceTs < 6 * 3600 * 1000) return _priceCache;
  const url = "https://api.porkbun.com/api/json/v3/pricing/get";
  let pricing = null;
  for (const opt of [{ method: "GET" }, { method: "POST", body: "{}" }]) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 7000);
      const r = await fetch(url, { ...opt, headers: { "content-type": "application/json" }, signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j && j.status === "SUCCESS" && j.pricing) { pricing = j.pricing; break; }
    } catch (e) { /* try next */ }
  }
  if (!pricing) return null;
  const want = ["com", "ai", "io", "co", "net", "org", "app", "dev"];
  const out = {};
  for (const t of want) {
    const p = pricing[t];
    if (p && p.registration != null) { const n = parseFloat(p.registration); if (!isNaN(n)) out["." + t] = n; }
  }
  _priceCache = out; _priceTs = Date.now();
  return out;
}

// Google Trends daily trending searches via the public RSS feed (no auth).
let _trCache = {}, _trTs = {};
async function googleTrends(geo) {
  geo = (String(geo || "US").toUpperCase().match(/[A-Z]{2}/) || ["US"])[0];
  if (_trCache[geo] && Date.now() - _trTs[geo] < 30 * 60 * 1000) return _trCache[geo];
  const urls = [
    "https://trends.google.com/trending/rss?geo=" + geo,
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=" + geo
  ];
  let xml = null;
  for (const u of urls) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 7000);
      const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0", "accept": "application/rss+xml,application/xml,text/xml" }, signal: ac.signal });
      clearTimeout(t);
      if (r.ok) { const txt = await r.text(); if (txt && txt.indexOf("<item") >= 0) { xml = txt; break; } }
    } catch (e) { /* try next */ }
  }
  if (!xml) return null;
  const items = [], re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && items.length < 25) {
    const block = m[1];
    const tm = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block);
    const af = /<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/.exec(block);
    if (tm) { const title = tm[1].replace(/<[^>]+>/g, "").trim(); if (title) items.push({ title, traffic: af ? af[1].trim() : null }); }
  }
  _trCache[geo] = items; _trTs[geo] = Date.now();
  return items;
}

// AI-generated brandable names via the Anthropic API. Needs ANTHROPIC_API_KEY in the
// environment; model overridable with ANVIL_AI_MODEL. Cached per keyword to limit cost.
let _aiCache = {}, _aiTs = {};
async function aiNames(seed, maxLen) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { names: [], error: "AI names need an ANTHROPIC_API_KEY set in your Vercel project." };
  seed = String(seed || "").slice(0, 80).trim();
  if (!seed) return { names: [] };
  const maxL = Math.max(3, Math.min(20, parseInt(maxLen, 10) || 14));
  const ck = seed.toLowerCase() + "|" + maxL;
  if (_aiCache[ck] && Date.now() - _aiTs[ck] < 10 * 60 * 1000) return { names: _aiCache[ck] };
  const model = process.env.ANVIL_AI_MODEL || "claude-haiku-4-5-20251001";
  const sys = "You are a brand naming expert generating short, brandable, pronounceable company and domain names. Output ONLY names, one per line. Each name must be lowercase, letters a-z only (no spaces, numbers, hyphens, punctuation, or domain extensions), and between 3 and " + maxL + " characters. No explanations, no numbering.";
  const user = "Generate 40 brandable name ideas for a business about: \"" + seed + "\". Mix real-word, invented/coined, and compound styles. Favor short, memorable, startup-quality names that sound like real brands. Avoid generic dictionary mashups.";
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 18000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 700, system: sys, messages: [{ role: "user", content: user }] }),
      signal: ac.signal
    });
    clearTimeout(t);
    if (!r.ok) { return { names: [], error: "AI request failed (" + r.status + "). Check the API key / model." }; }
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const STOP = new Set("here there these those some ideas names name sure okay yeah the for and your you list below brand business domain options option".split(" "));
    const out = [], seen = new Set();
    for (let ln of text.split(/\n+/)) {
      ln = ln.trim().replace(/^[\d).\-*\s]+/, "");
      const c = (ln.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z]/g, "");
      if (c.length >= 3 && c.length <= maxL && !seen.has(c) && !STOP.has(c)) { seen.add(c); out.push(c); }
    }
    _aiCache[ck] = out; _aiTs[ck] = Date.now();
    return { names: out };
  } catch (e) { return { names: [], error: "AI request timed out." }; }
}

// AI "rising niches": Claude + web search surfaces topics/markets climbing over the
// past month or two, returned as brandable seeds for domain ideas. Needs ANTHROPIC_API_KEY.
let _ideasCache = {}, _ideasTs = {};
function parseIdeas(j) {
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  let arr = null; const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = null; } }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (!it) continue;
    const topic = String(it.topic || it.name || "").replace(/[<>"]/g, "").trim().slice(0, 40);
    const blurb = String(it.blurb || it.why || "").replace(/[<>"]/g, "").trim().slice(0, 130);
    if (topic) out.push({ topic, blurb });
    if (out.length >= 20) break;
  }
  return out;
}
async function aiIdeas(geo) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ideas: [], error: "Rising niches needs an ANTHROPIC_API_KEY set in your Vercel project." };
  geo = (String(geo || "US").toUpperCase().match(/[A-Z]{2}/) || ["US"])[0];
  if (_ideasCache[geo] && Date.now() - _ideasTs[geo] < 6 * 3600 * 1000) return { ideas: _ideasCache[geo] };
  const model = process.env.ANVIL_AI_MODEL || "claude-haiku-4-5-20251001";
  const sys = "You are a trend analyst helping a founder spot rising business niches to build a brand or domain around. Respond with ONLY a JSON array of up to 20 objects, each {\"topic\":\"<1-3 word brandable seed>\",\"blurb\":\"<8-16 word reason it's rising>\"}. No prose outside the JSON.";
  const user = "Find ~20 niches, products, or markets whose interest has been climbing over the past one to two months" + (geo !== "US" ? (" in " + geo) : "") + " — emerging consumer/business trends (the way peptides spiked recently), not one-day news or celebrities. Each should make a sensible brand or domain idea. Return the JSON array only.";
  const headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 55000);
    let r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers, signal: ac.signal,
      body: JSON.stringify({ model, max_tokens: 1600, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }], system: sys, messages: [{ role: "user", content: user }] })
    });
    clearTimeout(t);
    if (!r.ok) { // web search may be unavailable on the account — retry from model knowledge
      const r2 = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 1200, system: sys, messages: [{ role: "user", content: user }] }) });
      if (!r2.ok) return { ideas: [], error: "AI request failed (" + r.status + ")." };
      return { ideas: parseIdeas(await r2.json()) };
    }
    const ideas = parseIdeas(await r.json());
    if (ideas.length) { _ideasCache[geo] = ideas; _ideasTs[geo] = Date.now(); }
    return { ideas };
  } catch (e) { return { ideas: [], error: "AI request timed out." }; }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const isBatch = !!q.domains;
  const confirm = !!q.confirm;

  if (q.prices) {
    const prices = await porkbunPrices();
    res.setHeader("Cache-Control", "public, s-maxage=43200, stale-while-revalidate=86400");
    res.status(200).json({ prices: prices || {} });
    return;
  }

  if (q.trends) {
    const items = await googleTrends(q.geo);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ trends: items || [] });
    return;
  }

  if (q.ai) {
    const out = await aiNames(q.seed, q.max);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(out);
    return;
  }

  if (q.ideas) {
    const out = await aiIdeas(q.geo);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(out);
    return;
  }

  const list = (q.domains ? String(q.domains).split(",") : (q.domain ? [q.domain] : []))
    .map(sanitize).filter(valid).slice(0, 50);

  if (!list.length) { res.status(400).json({ error: "missing or invalid domain(s)" }); return; }

  try {
    let results;
    if (confirm) {
      results = await mapLimit(list, 8, rdapConfirm);          // authoritative registry double-check
    } else {
      results = await mapLimit(list, 24, checkDomain);
      const nc = await namecheapMap(list);
      if (nc) {
        results = results.map((r, i) => {
          const d = list[i];
          if (nc[d] === true) return { state: "available", source: "namecheap" };
          if (nc[d] === false && r.state === "available") return { state: "taken", source: "namecheap" };
          return r;
        });
      }
    }
    if (isBatch) res.status(200).json({ results });
    else res.status(200).json(results[0]);
  } catch (e) {
    if (isBatch) res.status(200).json({ results: list.map(() => ({ state: "unknown" })) });
    else res.status(200).json({ state: "unknown" });
  }
};
