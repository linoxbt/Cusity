"""Writes the app pages (web/<page>.html). They share one head; only the title, description and data-page
differ, so they are generated rather than copied by hand.   python scripts/make_pages.py"""
SITE = "https://cusity.vercel.app"
PAGES = {
    "check": ("Check", "Check any wallet in the campaign snapshot: its 64 input bits, the circuit's verdict and margin."),
    "explain": ("Explain", "Why the circuit decided: the inputs that would flip the verdict and the gates that decide it."),
    "cluster": ("Cluster", "Wallets linked by a shared funder, a shared collection address or direct transfers."),
    "audit": ("Audit", "The circuit's accuracy, scored on chain against a test set committed before the campaign."),
    "appeal": ("Appeal", "Think a verdict is wrong? Open a public appeal with the wallet and the exact bits it was given."),
    "campaign": ("Campaign", "Every commitment of the campaign, in order, each checkable in your browser."),
    "model": ("Model", "The model card: circuit hash, size, held-out accuracy, false-positive rate and limits."),
    "feature": ("Input", "One input of the circuit: this wallet's value, what-if verdicts and how bots and humans differ."),
    "stage": ("Stage", "One stage of the circuit for this wallet: which neurons fired and which ones matter most."),
    "step": ("Campaign step", "One campaign commitment in detail, with an in-browser check."),
}
HEAD = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title} · Cusity</title>
  <meta name="description" content="{desc}" />
  <link rel="canonical" href="{site}/{page}.html" />
  <meta property="og:title" content="{title} · Cusity" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:image" content="{site}/og-image-1200x630.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#0B0D10" />
  <link rel="icon" href="./favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="./apple-touch-icon-180.png" />
  <link rel="preload" href="./src/fonts/SpaceGrotesk.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="./src/fonts/JetBrainsMono.woff2" as="font" type="font/woff2" crossorigin />
  <script type="speculationrules">{{"prefetch":[{{"where":{{"href_matches":"/*.html"}},"eagerness":"moderate"}}]}}</script>
</head>
<body class="app" data-page="{page}">
  <noscript><p style="padding:24px;font-family:sans-serif">Cusity needs JavaScript: every check runs in your browser.</p></noscript>
  <script type="module" src="./src/app.ts"></script>
</body>
</html>
"""
for page, (title, desc) in PAGES.items():
    open(f"web/{page}.html", "w").write(HEAD.format(title=title, desc=desc, site=SITE, page=page))
print(f"{len(PAGES)} pages written")
