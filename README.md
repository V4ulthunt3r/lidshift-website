# LidShift — landing page

Static landing page for **LidShift**, a macOS menu bar utility that reads the
physical lid angle of a MacBook and turns closing the lid into an effect on the
desktop (Glass, Shutter, Paper, Dust, Burn, Freeze & Shatter, CRT, or plain Dim).

English is the default; German lives alongside it.

| Page | English | German |
| --- | --- | --- |
| Landing | `index.html` | `index-de.html` |
| Support | `support.html` | `support-de.html` |
| Privacy policy | `privacy.html` | `privacy-de.html` |
| Legal notice | `impressum.html` | `impressum-de.html` |

## Structure

```
assets/landing.css   all styles, light + dark, tokens on :root / .dark
assets/site.js       theme toggle, nav scroll edge, scroll reveal
assets/lid.js        the interactive lid demo (drag, spring, effect layers)
assets/icon-*.png    generated from the app icon in the Xcode project
```

Everything is hand-written static HTML — no build step, no dependencies, no
tracking. `.nojekyll` keeps GitHub Pages from processing the files.

The demo in the hero mirrors the app's own shader (`FoldShaders.metal`): the
same closure progress `(start − angle) / (start − 20)` drives CSS custom
properties that each effect layer reads. Dust draws its grains on a canvas,
Freeze & Shatter clones the mock desktop into triangular shards, and Burn and
Freeze use the inline SVG filters `#burn-edge` and `#ice`.

## Publishing

GitHub Pages, from the `main` branch, root folder. The canonical URLs assume
<https://v4ulthunt3r.github.io/lidshift-website/>; update them in the `<head>`
of each page and in `sitemap.xml` if the site moves to a custom domain.

## Local preview

```bash
python3 -m http.server 4173
```
