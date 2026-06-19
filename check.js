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

async function fetchT(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { headers: { accept: "application/dns-json" }, signal: ac.signal }); }
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const isBatch = !!q.domains;
  const list = (q.domains ? String(q.domains).split(",") : (q.domain ? [q.domain] : []))
    .map(sanitize).filter(valid).slice(0, 50);

  if (!list.length) { res.status(400).json({ error: "missing or invalid domain(s)" }); return; }

  try {
    let results = await mapLimit(list, 16, checkDomain);
    const nc = await namecheapMap(list);
    if (nc) {
      results = results.map((r, i) => {
        const d = list[i];
        if (nc[d] === true) return { state: "available", source: "namecheap" };
        if (nc[d] === false && r.state === "available") return { state: "taken", source: "namecheap" };
        return r;
      });
    }
    if (isBatch) res.status(200).json({ results });
    else res.status(200).json(results[0]);
  } catch (e) {
    if (isBatch) res.status(200).json({ results: list.map(() => ({ state: "unknown" })) });
    else res.status(200).json({ state: "unknown" });
  }
};
