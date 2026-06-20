#!/usr/bin/env node
/* Anvil — programmatic SEO generator
 * Produces one content-rich landing page per niche (e.g. "Coffee shop name ideas"),
 * a hub page that links them all, and a sitemap.xml — all static files that deploy
 * alongside index.html. Each page funnels into the live app via /?q=<keyword>.
 *
 * RUN:   node seo/generate.js
 * OUTPUT: ideas/index.html, ideas/<slug>/index.html, sitemap.xml, robots.txt
 *
 * >>> EDIT THIS to your real deployed domain (used for canonical + OG + sitemap): <<<
 */
const SITE = process.env.ANVIL_SITE || "https://anvil.example.com";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

/* ---------------------------------------------------------------- niches --- */
// label: shown to users · q: the search seed · words: used to spin example names
// cat: drives tailored tips / FAQ / recommended endings (keeps pages non-duplicate)
const NICHES = [
  // local / food & drink
  { slug:"coffee-shop",      label:"coffee shop",        q:"coffee shop",        cat:"local",   words:["coffee","brew","roast","bean","cafe","espresso","grind","cup","steam","mocha"] },
  { slug:"bakery",           label:"bakery",             q:"bakery",             cat:"local",   words:["bake","bread","crumb","dough","flour","oven","loaf","sweet","crust","butter"] },
  { slug:"restaurant",       label:"restaurant",         q:"restaurant",         cat:"local",   words:["table","plate","feast","kitchen","fork","savor","dish","bistro","hearth","spice"] },
  { slug:"food-truck",       label:"food truck",         q:"food truck",         cat:"local",   words:["truck","street","bite","wheel","grub","curb","roam","fuel","feast","roll"] },
  { slug:"brewery",          label:"brewery",            q:"brewery",            cat:"local",   words:["brew","hop","barrel","craft","malt","ferment","cask","ale","tap","barley"] },
  { slug:"bar",              label:"bar",                q:"cocktail bar",       cat:"local",   words:["pour","mix","shaker","tonic","rye","barrel","lush","cellar","night","craft"] },
  { slug:"juice-bar",        label:"juice bar",          q:"juice bar smoothie", cat:"local",   words:["juice","fresh","press","green","blend","pulp","glow","vital","root","squeeze"] },
  // beauty / wellness
  { slug:"salon",            label:"hair salon",         q:"hair salon",         cat:"beauty",  words:["hair","style","mane","glow","strand","shear","luxe","curl","sleek","tress"] },
  { slug:"barbershop",       label:"barbershop",         q:"barbershop",         cat:"beauty",  words:["fade","blade","clip","groom","sharp","chair","crew","trim","edge","razor"] },
  { slug:"spa",              label:"spa",                q:"spa wellness",       cat:"beauty",  words:["calm","glow","serene","bloom","restore","soothe","aura","still","renew","zen"] },
  { slug:"skincare-brand",   label:"skincare brand",     q:"skincare brand",     cat:"commerce",words:["glow","derma","silk","bloom","pure","dew","velvet","calm","radiant","luxe"] },
  // fitness
  { slug:"gym",              label:"gym",                q:"gym fitness",        cat:"fitness", words:["iron","forge","peak","pulse","power","rep","grit","strong","summit","drive"] },
  { slug:"yoga-studio",      label:"yoga studio",        q:"yoga studio",        cat:"fitness", words:["flow","calm","breath","bend","still","balance","root","prana","bloom","zen"] },
  { slug:"personal-training",label:"personal training",  q:"personal trainer",   cat:"fitness", words:["coach","drive","fit","peak","shape","grit","pulse","train","gain","forge"] },
  // tech / startup
  { slug:"saas-startup",     label:"SaaS startup",       q:"saas startup",       cat:"tech",    words:["flow","stack","sync","grid","cloud","scale","ops","launch","pulse","forge"] },
  { slug:"ai-startup",       label:"AI startup",         q:"ai startup",         cat:"tech",    words:["mind","neural","cortex","logic","spark","sense","model","think","nova","brainy"] },
  { slug:"mobile-app",       label:"mobile app",         q:"mobile app",         cat:"tech",    words:["tap","loop","snap","flow","pocket","spark","ping","swift","glide","beam"] },
  { slug:"fintech",          label:"fintech",            q:"fintech finance app",cat:"tech",    words:["pay","ledger","mint","vault","coin","stack","flow","capital","fund","wise"] },
  { slug:"crypto-web3",      label:"crypto / web3",      q:"crypto web3",        cat:"tech",    words:["chain","block","token","mint","ledger","node","stake","vault","onchain","nexus"] },
  { slug:"dev-tool",         label:"developer tool",     q:"developer tool",     cat:"tech",    words:["build","ship","deploy","stack","forge","run","compile","commit","loop","kit"] },
  // creative
  { slug:"photography",      label:"photography business",q:"photography",       cat:"creative",words:["lens","light","frame","focus","shot","aperture","glow","capture","still","prism"] },
  { slug:"podcast",          label:"podcast",            q:"podcast",            cat:"creative",words:["mic","wave","echo","voice","airwave","record","tune","signal","studio","cast"] },
  { slug:"blog",             label:"blog",               q:"blog",               cat:"creative",words:["quill","ink","page","story","journal","muse","scribe","note","draft","prose"] },
  { slug:"design-studio",    label:"design studio",      q:"design studio",      cat:"creative",words:["pixel","form","studio","craft","hue","shape","grid","prism","canvas","draft"] },
  { slug:"youtube-channel",  label:"YouTube channel",    q:"youtube channel",    cat:"creative",words:["play","frame","reel","stream","spark","vlog","tube","scene","loop","beam"] },
  // professional
  { slug:"law-firm",         label:"law firm",           q:"law firm",           cat:"pro",     words:["lex","justice","counsel","brief","verdict","scale","advocate","summit","north","oak"] },
  { slug:"consulting",       label:"consulting firm",    q:"consulting",         cat:"pro",     words:["advise","strategy","north","summit","logic","clarity","forge","atlas","pivot","scope"] },
  { slug:"accounting",       label:"accounting firm",    q:"accounting",         cat:"pro",     words:["ledger","balance","sum","audit","north","clarity","tally","figure","vault","keystone"] },
  { slug:"real-estate",      label:"real estate",        q:"real estate",        cat:"pro",     words:["home","key","nest","estate","haven","door","abode","north","summit","dwell"] },
  { slug:"marketing-agency", label:"marketing agency",   q:"marketing agency",   cat:"pro",     words:["spark","reach","amplify","pulse","grow","signal","bold","north","launch","bright"] },
  // commerce / brands
  { slug:"clothing-brand",   label:"clothing brand",     q:"clothing brand",     cat:"commerce",words:["thread","stitch","wear","fabric","loom","drape","vogue","cloth","weave","muse"] },
  { slug:"jewelry-brand",    label:"jewelry brand",      q:"jewelry brand",      cat:"commerce",words:["gem","luster","gold","facet","stone","shine","gilt","aura","jewel","prism"] },
  { slug:"candle-brand",     label:"candle brand",       q:"candle brand",       cat:"commerce",words:["wick","glow","ember","flame","wax","scent","amber","warm","melt","lumen"] },
  { slug:"ecommerce-store",  label:"online store",       q:"online store",       cat:"commerce",words:["shop","cart","market","bazaar","goods","trove","stock","supply","mercado","emporium"] },
  // home services
  { slug:"cleaning-service", label:"cleaning service",   q:"cleaning service",   cat:"service", words:["clean","fresh","sparkle","shine","tidy","pure","gleam","crisp","spruce","glow"] },
  { slug:"landscaping",      label:"landscaping",        q:"landscaping",        cat:"service", words:["green","grove","root","bloom","lawn","terra","leaf","field","meadow","sprout"] },
  { slug:"wedding-planning", label:"wedding planning",   q:"wedding planning",   cat:"service", words:["vow","bloom","aisle","forever","knot","celebrate","grace","union","blush","ever"] },
  { slug:"interior-design",  label:"interior design",    q:"interior design",    cat:"creative",words:["space","form","hue","nest","abode","studio","decor","haven","grain","craft"] },
];

/* ----------------------------------------------- per-category copy banks --- */
const CAT = {
  local:    { endings:[".com",".co",".cafe"], style:"a warm, real-word name that's easy to say out loud and remember",
              tips:["Lead with a real word people already know — local customers should be able to spell it after hearing it once.",
                    "Keep it short. A two-syllable name fits on a sign, a cup, and a storefront window without crowding.",
                    "Avoid hyphens and numbers — they get lost when someone tells a friend your name in person.",
                    "Check that the matching .com is open; locals will guess yours ends in .com before anything else."],
              faqExtra:["Should a local business use .com or a niche ending?",
                        "A .com is still the safest default because customers assume it — but a niche ending like .cafe or .co can work if the .com is taken and the name is strong."] },
  beauty:   { endings:[".com",".co",".studio"], style:"an elegant, evocative name that signals craft and care",
              tips:["Favor soft, flowing sounds — names with open vowels feel premium and calming.",
                    "A single distinctive word often beats a descriptive phrase for a beauty brand.",
                    "Make sure the name looks good lowercase, since that's how it'll appear on Instagram.",
                    "Pair the name with an available handle — social discovery matters more here than search."],
              faqExtra:["Does my salon name need the word 'hair' or 'beauty' in it?",
                        "No — a memorable brandable word plus a strong logo communicates the category better than a literal description, and reads more premium."] },
  fitness:  { endings:[".com",".fit",".co"], style:"a punchy, high-energy name that sounds strong when shouted",
              tips:["Hard consonants (k, t, p, x) and short words read as powerful and energetic.",
                    "One-word names dominate in fitness — think momentum, not description.",
                    "Test it as a chant or a class name; if it has rhythm, it'll stick.",
                    "Grab the social handle early — fitness brands live and grow on Instagram and TikTok."],
              faqExtra:["Is a .fit or .gym ending worth it over .com?",
                        "Only if the .com is gone and the name is excellent. A great short name on .com still outperforms a compromise on a niche ending."] },
  tech:     { endings:[".com",".ai",".io",".dev"], style:"a coined, brandable name that scales beyond one product",
              tips:["Invented words (think 'Stripe', 'Notion') give you a clean trademark and a unique search footprint.",
                    "Keep it under three syllables — engineers and investors will type it constantly.",
                    "Vowel-ending coined names ('-io', '-a', '-ly') feel modern and are easy to pronounce.",
                    "If the .com is taken, .ai and .io are fully accepted in tech and signal the category."],
              faqExtra:["Is .ai or .io okay for a startup, or do I need .com?",
                        "In tech, .ai and .io are completely normal and even expected for AI and dev-tool startups. Plenty of funded companies run on them — a strong name matters far more than the ending."] },
  creative: { endings:[".com",".co",".studio"], style:"a distinctive, story-friendly name with personality",
              tips:["Pick a word with a hint of story or texture — creative audiences reward a name with character.",
                    "Make sure it's easy to say in a podcast intro or credits roll without spelling it out.",
                    "Short and ownable beats clever-but-confusing; you'll repeat this name a lot.",
                    "Line up the matching social handle so your audience can find you off-platform."],
              faqExtra:["Should my channel/blog name match my own name?",
                        "A personal name is fine, but a distinct brandable name is easier to grow, sell, or expand into a business later."] },
  pro:      { endings:[".com",".co",".law"], style:"a credible, trustworthy name that signals authority",
              tips:["Names rooted in solidity — north, summit, oak, keystone — convey stability to clients.",
                    "Avoid trendy spellings; professional services trade on trust, and odd spelling reads as risky.",
                    "A real-word or place-evoking name ages better than a coined one in law, finance, and consulting.",
                    "Confirm the .com is available — clients will judge a missing or odd domain harshly."],
              faqExtra:["Do professional firms still need a .com?",
                        "Yes, more than most. In law, finance, and consulting, clients expect a clean .com and may distrust an unusual ending."] },
  commerce: { endings:[".com",".co",".store",".shop"], style:"a memorable brand name that looks good on a label and a checkout page",
              tips:["Think about how the name reads on packaging and in a customer's order confirmation.",
                    "A coined or evocative single word builds a brand you own, versus a generic descriptive phrase.",
                    "Keep it trademark-friendly — avoid names that just describe the product category.",
                    "Secure the .com and the social handle together; ecommerce discovery spans both."],
              faqExtra:["Is .shop or .store a good idea for an online store?",
                        "They can work and are clearly e-commerce, but .com still converts best because shoppers trust and auto-type it. Use a niche ending only if the .com is unavailable."] },
  service:  { endings:[".com",".co"], style:"a clear, reassuring name that's easy to recommend by word of mouth",
              tips:["Word-of-mouth is everything for local services — pick a name people can say once and remember.",
                    "Clean, friendly real words beat clever coined names for trust and recall.",
                    "Skip hyphens and numbers so referrals don't get garbled.",
                    "A .com plus a simple, spellable name makes you the easy choice to look up later."],
              faqExtra:["Does a service business name need to describe what I do?",
                        "It helps a little for first impressions, but a short memorable name plus clear messaging on your site works better than a long descriptive domain."] },
};

/* ---------------------------------------------------------- name spinner --- */
const PRE = ["get","go","try","my"];
const SUF = ["ly","hq","lab","hub","co","kit","works","house","spot","club","nest","yard","forge","craft"];
const BRAND = ["nest","forge","peak","harbor","grove","loop","spark","atlas","cove","ember","haven","summit","mint","sage"];
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
function spin(words){
  const out=new Set();
  const w=words.slice();
  for(const x of w){
    SUF.slice(0,4).forEach(s=>out.add(x+s));
    PRE.slice(0,2).forEach(p=>out.add(p+x));
    BRAND.slice(0,3).forEach(b=>out.add(x+b));
  }
  for(let i=0;i<w.length;i++) for(let j=0;j<w.length;j++) if(i!==j) out.add(w[i]+w[j]);
  return [...out].filter(n=>n.length>=4 && n.length<=15 && /^[a-z]+$/.test(n))
                 .sort((a,b)=>a.length-b.length).slice(0,24);
}

/* --------------------------------------------------------------- helpers --- */
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const rel = (slug)=> NICHES.filter(n=>n.slug!==slug);
function relatedFor(n){
  const same = rel(n.slug).filter(x=>x.cat===n.cat).slice(0,4);
  const other = rel(n.slug).filter(x=>x.cat!==n.cat).slice(0,3);
  return [...same, ...other].slice(0,6);
}

const STYLE_CSS = `
:root{--bg:#0f0d0c;--bg2:#171311;--ink:#f4ede4;--muted:#b3a496;--faint:#8a7d70;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.14);--amber:#ff8a3d;--gold:#ffc24b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:880px;margin:0 auto;padding:22px 20px 80px}
.top{display:flex;align-items:center;justify-content:space-between;padding:6px 0 26px;border-bottom:1px solid var(--line);margin-bottom:34px}
.brand{font-family:"IBM Plex Mono",monospace;font-weight:600;letter-spacing:.04em;color:var(--ink);font-size:18px}
.brand b{background:linear-gradient(90deg,var(--gold),var(--amber));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.crumb{font-size:12.5px;color:var(--faint);margin-bottom:14px;font-family:"IBM Plex Mono",monospace}
h1{font-size:clamp(28px,5vw,42px);line-height:1.1;margin:0 0 12px;letter-spacing:-.01em}
.sub{font-size:18px;color:var(--muted);margin:0 0 26px;max-width:60ch}
.cta{display:inline-block;background:linear-gradient(90deg,var(--amber),var(--gold));color:#1a1209;font-weight:600;padding:13px 22px;border-radius:12px;font-size:15px;margin:4px 0 8px}
.cta:hover{text-decoration:none;filter:brightness(1.05)}
h2{font-size:22px;margin:42px 0 14px;letter-spacing:-.01em}
.ideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px;margin:6px 0}
.ideas a{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:10px 13px;color:var(--ink);font-family:"IBM Plex Mono",monospace;font-size:14px;transition:border-color .15s}
.ideas a:hover{border-color:var(--amber);text-decoration:none}
.ideas a span{color:var(--faint)}
ul.tips{padding-left:0;list-style:none;margin:6px 0}
ul.tips li{padding:11px 0 11px 30px;border-bottom:1px solid var(--line);position:relative}
ul.tips li:before{content:"→";position:absolute;left:4px;color:var(--amber)}
.ends{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.ends span{font-family:"IBM Plex Mono",monospace;font-size:13px;background:var(--bg2);border:1px solid var(--line2);border-radius:8px;padding:6px 11px;color:var(--muted)}
.faq{margin:6px 0}
.faq details{border-bottom:1px solid var(--line);padding:13px 0}
.faq summary{cursor:pointer;font-weight:600;font-size:16px}
.faq p{color:var(--muted);margin:9px 0 2px}
.rel{display:flex;gap:9px;flex-wrap:wrap;margin:6px 0}
.rel a{background:var(--bg2);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13.5px;color:var(--muted)}
.rel a:hover{border-color:var(--amber);color:var(--ink);text-decoration:none}
footer{margin-top:54px;padding-top:22px;border-top:1px solid var(--line);color:var(--faint);font-size:13.5px;display:flex;gap:18px;flex-wrap:wrap}
.hubgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:11px;margin:10px 0}
.hubcard{display:block;background:var(--bg2);border:1px solid var(--line);border-radius:13px;padding:16px 17px;color:var(--ink)}
.hubcard:hover{border-color:var(--amber);text-decoration:none}
.hubcard b{display:block;font-size:16px;margin-bottom:3px}
.hubcard span{color:var(--faint);font-size:13px}
.catlabel{font-family:"IBM Plex Mono",monospace;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin:34px 0 10px}
`;

function head(title, desc, canonical, jsonld){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>${STYLE_CSS}</style>
${jsonld.map(o=>`<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("")}
</head><body><div class="wrap">
<div class="top"><a class="brand" href="/"><b>Anvil</b></a><a href="/ideas/">All name ideas →</a></div>`;
}
const foot = `<footer><a href="/">Domain finder</a><a href="/ideas/">All industries</a><a href="https://podcept.com">Podcept</a></footer></div></body></html>`;

/* --------------------------------------------------------------- builders --- */
function nichePage(n){
  const c = CAT[n.cat];
  const url = `${SITE}/ideas/${n.slug}/`;
  const title = `${cap(n.label)} Name Ideas + Domain Generator | Anvil`;
  const desc = `Generate ${n.label} name ideas and check domain availability instantly. Brandable ${n.label} names across ${c.endings.slice(0,3).join(", ")} — scored, filtered, and ready to register.`;
  const ideas = spin(n.words);
  const tips = c.tips;
  const related = relatedFor(n);
  const faqs = [
    [`How do I come up with a good ${n.label} name?`, `Start from words tied to your ${n.label} — ${n.words.slice(0,4).join(", ")} — then combine them with short brandable endings or pair two together. Anvil does this automatically: enter "${n.q}" and it generates ${ideas.length>0?"dozens of":"many"} scored options and checks which domains are actually open.`],
    [`What domain ending should a ${n.label} use?`, `${cap(c.style)}. Recommended endings: ${c.endings.join(", ")}. Anvil checks your name across all of them at once so you can compare what's available.`],
    c.faqExtra,
    [`Are these ${n.label} names available to register?`, `The ideas below are inspiration. Click any one — or hit the generate button — and Anvil checks live domain availability across every ending in real time, so you only see what you can actually buy.`]
  ];
  const jsonld = [
    { "@context":"https://schema.org","@type":"WebPage","name":title,"description":desc,"url":url },
    { "@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
      {"@type":"ListItem","position":1,"name":"Anvil","item":SITE+"/"},
      {"@type":"ListItem","position":2,"name":"Name ideas","item":SITE+"/ideas/"},
      {"@type":"ListItem","position":3,"name":cap(n.label),"item":url}]},
    { "@context":"https://schema.org","@type":"FAQPage","mainEntity":faqs.map(f=>({"@type":"Question","name":f[0],"acceptedAnswer":{"@type":"Answer","text":f[1]}})) }
  ];
  return head(title, desc, url, jsonld) + `
<div class="crumb"><a href="/">Anvil</a> / <a href="/ideas/">ideas</a> / ${esc(n.label)}</div>
<h1>${cap(n.label)} name ideas</h1>
<p class="sub">Brandable ${esc(n.label)} names with live domain availability. Generate ${esc(n.label)} domains, see a value score on each, and register the one you love.</p>
<a class="cta" href="/?q=${encodeURIComponent(n.q)}">Generate ${esc(n.label)} domains →</a>

<h2>${esc(cap(n.label))} name ideas to spark inspiration</h2>
<p style="color:var(--muted);margin:0 0 12px">Click any idea to check its availability across every ending in Anvil.</p>
<div class="ideas">${ideas.map(i=>`<a href="/?q=${encodeURIComponent(i)}">${esc(i)}<span>.com</span></a>`).join("")}</div>

<h2>How to name your ${esc(n.label)}</h2>
<ul class="tips">${tips.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>

<h2>Best domain endings for a ${esc(n.label)}</h2>
<p style="color:var(--muted);margin:0 0 8px">For a ${esc(n.label)}, aim for ${esc(c.style)}. Strong endings:</p>
<div class="ends">${c.endings.map(e=>`<span>${esc(e)}</span>`).join("")}</div>

<h2>${esc(cap(n.label))} naming — FAQ</h2>
<div class="faq">${faqs.map(f=>`<details><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join("")}</div>

<h2>Related name ideas</h2>
<div class="rel">${related.map(r=>`<a href="/ideas/${r.slug}/">${esc(cap(r.label))}</a>`).join("")}</div>
` + foot;
}

function hubPage(){
  const url = `${SITE}/ideas/`;
  const title = `Business Name Ideas by Industry — Domain Generator | Anvil`;
  const desc = `Free name idea generators for ${NICHES.length}+ industries — coffee shops, startups, agencies, brands and more. Generate brandable names and check domain availability instantly.`;
  const cats = {local:"Food, drink & local",beauty:"Beauty & wellness",fitness:"Fitness",tech:"Tech & startups",creative:"Creative & media",pro:"Professional services",commerce:"Brands & e-commerce",service:"Home & event services"};
  const byCat = {};
  for(const n of NICHES){ (byCat[n.cat] ||= []).push(n); }
  const jsonld = [
    { "@context":"https://schema.org","@type":"CollectionPage","name":title,"description":desc,"url":url },
    { "@context":"https://schema.org","@type":"ItemList","itemListElement":NICHES.map((n,i)=>({"@type":"ListItem","position":i+1,"name":cap(n.label)+" name ideas","url":`${SITE}/ideas/${n.slug}/`})) }
  ];
  let body = `<div class="crumb"><a href="/">Anvil</a> / ideas</div>
<h1>Name ideas by industry</h1>
<p class="sub">Pick your industry to generate brandable names and instantly see which domains are open. Every list runs on Anvil's live availability engine.</p>
<a class="cta" href="/">Open the full domain finder →</a>`;
  for(const cat of Object.keys(cats)){
    if(!byCat[cat]) continue;
    body += `<div class="catlabel">${esc(cats[cat])}</div><div class="hubgrid">` +
      byCat[cat].map(n=>`<a class="hubcard" href="/ideas/${n.slug}/"><b>${esc(cap(n.label))} names</b><span>Generate &amp; check ${esc(n.label)} domains</span></a>`).join("") +
      `</div>`;
  }
  return head(title, desc, url, jsonld) + body + foot;
}

function sitemap(){
  const urls = [ `${SITE}/`, `${SITE}/ideas/`, ...NICHES.map(n=>`${SITE}/ideas/${n.slug}/`) ];
  const today = new Date().toISOString().slice(0,10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u=>`  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`).join("\n") +
    `\n</urlset>\n`;
}

/* --------------------------------------------------------------- write all --- */
function writeFile(rel, content){
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive:true });
  fs.writeFileSync(full, content);
}
let count=0;
writeFile("ideas/index.html", hubPage()); count++;
for(const n of NICHES){ writeFile(`ideas/${n.slug}/index.html`, nichePage(n)); count++; }
writeFile("sitemap.xml", sitemap());
writeFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Generated ${count} pages + sitemap.xml + robots.txt for ${NICHES.length} niches.`);
console.log(`SITE = ${SITE}  (set ANVIL_SITE env var or edit the constant before deploying)`);
