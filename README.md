# Anvil — deploy with the availability backend

This folder is a complete, deployable site:

```
anvil/
  index.html        the app
  api/check.js       serverless availability endpoint  ->  /api/check
  README.md          this file
```

The app calls `/api/check` when it's deployed. If that endpoint isn't there
(for example, opening `index.html` straight off your disk), it automatically
falls back to the in-browser DNS check, so the file still works on its own.

---

## What the backend does (no setup required)

`api/check.js` checks domains **server-side**, in **batches**, using
**DNS-over-HTTPS** (Google, with Cloudflare as a fallback). NXDOMAIN means the
name is unregistered (`available`); nameservers pointing at a marketplace mean
`forsale` (with the marketplace name); other nameservers mean `taken`; anything
ambiguous is confirmed with an SOA lookup or returned as `unknown`. The app sends
~24 domains per request, so a 500-name search is a few dozen fast calls instead
of hundreds of slow ones. No API key, account, or IP whitelist required, and
results are cached at Vercel's edge for a day.

(An earlier version used the RDAP bootstrap at rdap.org; that free service
rate-limits under bulk load and returns 404 ambiguously, which caused stalls and
false "available" results — so the backend now uses high-volume DNS instead.)

---

## Deploy to Vercel (about 2 minutes)

**Option A — CLI**

```bash
npm i -g vercel        # once
cd anvil
vercel                 # follow prompts -> preview URL
vercel --prod          # production URL
```

**Option B — Dashboard**

1. Push this `anvil/` folder to a GitHub repo.
2. In the Vercel dashboard: **Add New… → Project → Import** that repo.
3. Framework preset: **Other**. Root directory: the repo root. Click **Deploy**.

No build step and no `vercel.json` are needed — Vercel serves `index.html`
statically and turns `api/check.js` into `/api/check` automatically.

That's it. The deployed site already uses the RDAP backend.

---

## Optional: turn on Namecheap's official check

This makes availability registry-exact and also tells you when a name is a
Namecheap **premium** listing. It's optional — RDAP already works well.

Heads-up on Namecheap's requirements (these are theirs, not the app's):

- **Account eligibility.** Namecheap only enables API access for accounts that
  meet a threshold (historically 20+ domains, a ~$50 balance, or ~$50 spent in
  the last 2 years). Check your **Profile → Tools → API Access**.
- **IP whitelist.** Namecheap requires you to whitelist the IP(s) that call the
  API. Vercel functions don't have a single fixed IP, so you'll need a static
  egress (e.g. a fixed-IP proxy, or run this endpoint on a host with a stable
  IP). This is the main friction with serverless — RDAP avoids it entirely.

If you clear those, set these as **Environment Variables** in Vercel
(Project → Settings → Environment Variables), then redeploy:

```
NAMECHEAP_API_USER     your Namecheap username
NAMECHEAP_API_KEY      from Profile -> Tools -> API Access
NAMECHEAP_USERNAME     usually the same as API_USER
NAMECHEAP_CLIENT_IP    the whitelisted IP that will call Namecheap
```

Test against Namecheap's sandbox first if you like (api.sandbox.namecheap.com)
by swapping the host in `api/check.js`.

An easier keyed alternative, if Namecheap's hurdles aren't worth it: **Domainr**
(via RapidAPI) gives availability/status with just an API key and no whitelist.
You can add it inside `namecheapCheck`'s spot the same way.

---

## What still needs more than this (aftermarket prices)

Showing the **actual asking price** of a for-sale domain, and detecting that one
domain is listed on several marketplaces, needs those marketplaces' own APIs
(Afternic / Sedo partner programs, or paid appraisal feeds like Estibot /
GoDaddy's appraisal API for estimates). There's no free, browser-readable price
feed, which is why the app links out to each marketplace instead of printing a
number. If you get access to one of those feeds, it slots into `api/check.js`
the same way the Namecheap block does.
