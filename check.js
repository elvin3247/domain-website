// /api/check?domain=example.com
// Returns { state: "available" | "forsale" | "taken" | "unknown", provider? }
//
// Default (no setup): authoritative availability via RDAP (the official registry
// protocol), with a DNS fallback for TLDs that don't publish RDAP. Needs no API key.
//
// Optional: set the four NAMECHEAP_* env vars to use Namecheap's official
// availability check on top (see README).

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

function classify(registered, ns) {
  if (registered === false) return { state: "available" };
  if (registered === true) {
    const hosts = (ns || []).map(h => (h || "").toLowerCase());
    for (const p of PARKING) {
      if (hosts.some(h => h.includes(p.k))) return { state: "forsale", provider: p.n };
    }
    return { state: "taken" };
  }
  return { state: "unknown" };
}

// Authoritative: RDAP via the rdap.org bootstrap (redirects to the registry's server).
async function rdap(domain) {
  try {
    const r = await fetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
      headers: { accept: "application/rdap+json" }, redirect: "follow"
    });
    if (r.status === 404) return { registered: false, ns: [] };
    if (r.status === 200) {
      const j = await r.json().catch(() => null);
      const ns = (j && Array.isArray(j.nameservers) ? j.nameservers : [])
        .map(n => (n.ldhName || "").toLowerCase());
      return { registered: true, ns };
    }
    return { registered: null, ns: [] }; // TLD without RDAP, rate limited, etc.
  } catch (e) {
    return { registered: null, ns: [] };
  }
}

// Fallback: DNS-over-HTTPS nameserver lookup (no CORS limits server-side).
async function dohNS(domain) {
  try {
    const r = await fetch("https://dns.google/resolve?name=" + encodeURIComponent(domain) + "&type=NS",
      { headers: { accept: "application/json" } });
    if (!r.ok) return { status: -1, ns: [] };
    const j = await r.json();
    const ns = []
      .concat((j.Answer || []).filter(a => a.type === 2).map(a => a.data || ""))
      .concat((j.Authority || []).filter(a => a.type === 2).map(a => a.data || ""))
      .map(h => h.toLowerCase());
    return { status: j.Status, ns };
  } catch (e) {
    return { status: -1, ns: [] };
  }
}

// Optional: Namecheap official availability check (returns true/false/null).
async function namecheapCheck(domain) {
  const u = process.env.NAMECHEAP_API_USER, k = process.env.NAMECHEAP_API_KEY,
        n = process.env.NAMECHEAP_USERNAME, ip = process.env.NAMECHEAP_CLIENT_IP;
  if (!u || !k || !n || !ip) return null;
  try {
    const url = "https://api.namecheap.com/xml.response"
      + "?ApiUser=" + encodeURIComponent(u)
      + "&ApiKey=" + encodeURIComponent(k)
      + "&UserName=" + encodeURIComponent(n)
      + "&ClientIp=" + encodeURIComponent(ip)
      + "&Command=namecheap.domains.check"
      + "&DomainList=" + encodeURIComponent(domain);
    const r = await fetch(url);
    if (!r.ok) return null;
    const xml = await r.text();
    const m = xml.match(/Available="(true|false)"/i);
    return m ? m[1].toLowerCase() === "true" : null;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Cache at the edge for a day — registration status changes slowly.
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");

  const domain = (req.query && req.query.domain
    ? req.query.domain
    : (new URL(req.url, "http://x").searchParams.get("domain") || "")).toString().trim().toLowerCase();

  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    res.status(400).json({ error: "missing or invalid domain" });
    return;
  }

  try {
    let { registered, ns } = await rdap(domain);
    if (registered === null) {
      const d = await dohNS(domain);
      if (d.status === 3) registered = false;
      else if (d.status === 0 && d.ns.length) { registered = true; ns = d.ns; }
    }

    // Namecheap (if configured) is authoritative for availability.
    const nc = await namecheapCheck(domain);
    if (nc === true) { res.status(200).json({ state: "available", source: "namecheap" }); return; }
    if (nc === false && registered !== true) registered = true;

    res.status(200).json(classify(registered, ns));
  } catch (e) {
    res.status(200).json({ state: "unknown" });
  }
};
