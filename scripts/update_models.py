#!/usr/bin/env python3
"""Builds data/models.json for the VSO app from Toyota Malaysia's public website.

  model description + model code : the current price-list PDFs (one per model family)
  colours                        : the colour list embedded in each model page (window.data_colors)
  colour code                    : only where Toyota prints it (e.g. "Silver Metallic (1D4)"), or the same colour
                                   name prints it on another model page, or data/colour-codes.json (manual list)

Run from the folder that contains data/ (the web root):   python update_models.py
If a model cannot be read, its previous entry is kept. Nothing is written if the result looks broken.
"""
import io
import json
import os
import re
import sys
import time
import datetime
import urllib.request
import urllib.error

import fitz  # PyMuPDF

BASE = "https://www.toyota.com.my"
LIST_URL = BASE + "/en/price-and-model-tools/price-list.html"
UA = "Mozilla/5.0 (compatible; VSO-Order-Updater/1.0)"
OUT = os.path.join("data", "models.json")
MANUAL = os.path.join("data", "colour-codes.json")

LABELS = {
    "vios-hev": "VIOS", "yaris": "YARIS", "toyota-yaris-cros-and-hev": "YARIS CROSS",
    "corolla-cross": "COROLLA CROSS", "corolla": "COROLLA", "camry-hev-and-ice": "CAMRY",
    "fortuner": "FORTUNER", "hilux": "HILUX", "hilux-bev": "HILUX BEV", "zenix": "INNOVA ZENIX",
    "veloz": "VELOZ", "alphard": "ALPHARD", "vellfire": "VELLFIRE", "harrier-hev": "HARRIER",
    "bz4x": "BZ4X", "urban-cruiser": "URBAN CRUISER", "gr-86": "GR86", "gr-corolla": "GR COROLLA",
    "gr-yaris": "GR YARIS", "hiace": "HIACE PANEL VAN", "all-new-hiace": "HIACE SLWB",
}

# price-list family -> model pages that hold its colours. First rule whose pattern matches the variant wins.
COLOUR_PAGES = {
    "vios-hev": ("vios", [(r"GR-?S", "vios/vios-hev-gr-sport"), (r"HEV", "vios/vios-hybrid-electric")]),
    "yaris": ("yaris", []),
    "toyota-yaris-cros-and-hev": ("yaris-cross-hybrid-electric", []),
    "corolla-cross": ("corolla-cross-hybrid-electric",
                      [(r"GR-?S", "corolla-cross-hybrid-electric/corolla-cross-hev-gr-sport")]),
    "corolla": ("corolla", [(r"GR", "corolla/corolla-gr-sport")]),
    "camry-hev-and-ice": ("camry-hybrid-electric", []),
    "fortuner": ("fortuner", []),
    "hilux": ("hilux", [(r"GR-?S", "hilux/hilux-gr-sport")]),
    "hilux-bev": ("hilux/hilux-bev", []),
    "zenix": ("zenix", [(r"HEV", "zenix/zenix-hybrid-electric")]),
    "veloz": ("veloz", []),
    "alphard": ("alphard", []),
    "vellfire": ("vellfire", [(r"HEV", "vellfire/vellfire-hybrid-electric")]),
    "harrier-hev": ("harrier-hybrid-electric", []),
    "bz4x": ("bz4x", []),
    "urban-cruiser": ("urban-cruiser", []),
    "gr-86": ("gr86", []),
    "hiace": ("hiace", []),
    "all-new-hiace": ("hiace-slwb", []),
    # gr-corolla / gr-yaris: Toyota's pages carry no colour list, so colours are typed by hand
}

CODE_RE = re.compile(r"^(?=[A-Z0-9 -]*\d)[A-Z][A-Z0-9]{2,9}-[A-Z0-9]{3,9}(?: [A-Z0-9]{2})?$")
STOP_RE = re.compile(r"^(Engine Capacity|Electric Motor|BDM|Individual Private|Company|Selling Price|Ref No)", re.I)


def log(*a):
    print(*a, flush=True)


def fetch(url, binary=False, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "ignore")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError("could not fetch %s: %s" % (url, last))


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def norm_desc(s):
    s = clean(s).upper()
    s = re.sub(r"^TOYOTA ", "", s)
    return s


# ---------------------------------------------------------------- price lists
def pdf_links(html):
    found = {}
    for m in re.finditer(r"/content/dam/malaysia/price-list-maintenance-packages/([^/\"' <>]+)/[^\"' <>]*?/1\.0-[^\"' <>]*\.pdf", html):
        found.setdefault(m.group(1), m.group(0))
    return found


def parse_pdf(data):
    doc = fitz.open(stream=data, filetype="pdf")
    lines = []
    for p in doc:
        lines += [clean(x) for x in p.get_text().split("\n") if clean(x)]
    codes = [l for l in lines if CODE_RE.match(l)]
    start = next((i + 1 for i, l in enumerate(lines) if l.lower().startswith("price list")), 0)
    heads, variants = [], []
    for l in lines[start:]:
        if STOP_RE.match(l):
            break
        if CODE_RE.match(l):
            continue
        (heads if re.match(r"^(toyota|hiace)\b", l, re.I) else variants).append(l)
    n = len(codes)
    if n == 0:
        raise ValueError("no model code found")
    if len(heads) == n and len(variants) == n:
        descs = [h + " " + v for h, v in zip(heads, variants)]
    elif len(heads) == n and not variants:
        descs = heads
    else:
        raise ValueError("cannot pair %d codes with %d headings / %d variants" % (n, len(heads), len(variants)))
    rows = [{"desc": norm_desc(d), "code": c} for d, c in zip(descs, codes)]
    try:
        table = colour_table(doc, [r["desc"] for r in rows])
    except Exception:
        table = None
    if table:
        for r, cols in zip(rows, table):
            if cols:
                r["pdf_colours"] = cols
    return rows


# ------------------------------------------------- colour tables inside each price list
# Layouts seen: "Colours Availability | Code | <variants>" (most models), "Description | Code | <variants>" (Yaris),
# "No. | Description | Code | <variants>" under "Exterior Colours" (Alphard, Vellfire). A header can cover several
# variants (e.g. "HILUX D/CAB"), and a cell saying "Available" can span several columns.
PUA_RE = re.compile(r"[-]")


def _vertical_lines(page):
    out = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.x - b.x) < 0.8:
                    out.append((a.x, min(a.y, b.y), max(a.y, b.y)))
            elif it[0] == "re":
                r = it[1]
                if r.width < 1.5 and r.height > 1:
                    out.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
    return out


def _tokens(s):
    s = s.upper().replace("A/T", "AT").replace("M/T", "MT").replace("4WD", "4X4").replace("ROUGE", "ROGUE")
    s = re.sub(r"^TOYOTA ", "", clean(s))
    return set(t for t in re.split(r"[\s,]+", s) if t)


def _best_partition(centres, spans, k):
    """Split n contiguous columns into k groups so each group's middle best matches the text centres."""
    n = len(spans)
    best = (None, 1e18)

    def rec(start, g, cuts, err):
        nonlocal best
        if g == k:
            if start == n and err < best[1]:
                best = (list(cuts), err)
            return
        for end in range(start + 1, n - (k - g - 1) + 1):
            mid = (spans[start][0] + spans[end - 1][1]) / 2
            rec(end, g + 1, cuts + [(start, end)], err + (mid - centres[g]) ** 2)

    rec(0, 0, [], 0.0)
    return best[0]


def _table_at(page, words, cw, descs):
    """Read the colour table whose header row contains the word 'Code' (cw). -> {column index: [colours]}, columns"""
    hy0, hy1 = cw[1], cw[3]
    band = sorted((w for w in words if abs(w[1] - hy0) < 4), key=lambda w: w[0])

    # 1) columns from the drawn borders crossing the header row (exact, works for most models)
    xs = sorted(x for x, y0, y1 in _vertical_lines(page) if y0 <= hy0 + 2 and y1 >= hy1 - 2)
    edges = []
    for x in xs:
        if not edges or x - edges[-1] > 1.5:
            edges.append(x)
    clusters = []
    cw_mid = (cw[0] + cw[2]) / 2
    seen_code = False
    for a_, b_ in zip(edges, edges[1:]):
        text = clean(" ".join(w[4] for w in band if a_ <= (w[0] + w[2]) / 2 < b_))
        if a_ <= cw_mid < b_:
            seen_code = True
            continue
        if not seen_code:
            continue
        if not text or re.search(r"price|^no\.?$|description", text, re.I):
            break
        clusters.append({"text": text, "lo": a_, "hi": b_, "x0": a_, "x1": b_})
    right = clusters[-1]["hi"] if clusters else page.rect.width

    # 2) no inner borders (Alphard, Vellfire): group the header words by spacing
    if not clusters:
        stops = [w[0] for w in band if w[0] > cw[2] + 5 and w[4] in ("No.", "Description", "Price")]
        right = min(stops) if stops else page.rect.width
        cols_words = [w for w in band if cw[2] + 3 < w[0] < right - 1 and w[4] not in ("Interior", "Exterior")]
        for w in cols_words:
            if clusters and w[0] - clusters[-1]["x1"] <= 12:
                clusters[-1]["words"].append(w[4])
                clusters[-1]["x1"] = w[2]
            else:
                clusters.append({"words": [w[4]], "x0": w[0], "x1": w[2]})
        if not clusters:
            return None
        for i, c in enumerate(clusters):
            c["text"] = clean(" ".join(c["words"]))
            c["lo"] = cw[2] + 3 if i == 0 else (clusters[i - 1]["x1"] + c["x0"]) / 2
        for i, c in enumerate(clusters):
            c["hi"] = (c["x1"] + clusters[i + 1]["x0"]) / 2 if i + 1 < len(clusters) else right
    spans = [(c["lo"], c["hi"]) for c in clusters]
    # table's left edge and the next table below (vellfire stacks Exterior over Interior)
    lefts = [w[0] for w in band if w[0] < cw[0]]
    left = max(0.0, min(lefts) - 80) if lefts else 0  # row numbers can sit left of the header text (Yaris)
    below = [w[1] for w in words if w[4] == "Code" and w[1] > hy1 + 20 and abs(w[0] - cw[0]) < 30]
    y_limit = min(below) if below else page.rect.height
    idx = sorted((w for w in words if re.match(r"^\d{1,2}\)?$", w[4]) and left <= w[0] < cw[0] - 8
                  and hy1 < w[1] < y_limit), key=lambda w: w[1])
    if idx:  # row numbers sit in the table's first column; a "2" inside a colour name (Super White 2) must not count
        first_x = min(w[0] for w in idx)
        idx = [w for w in idx if w[0] <= first_x + 8]
    seq, want = [], 1
    for w in idx:
        if int(w[4].rstrip(")")) == want:
            seq.append(w)
            want += 1
    idx = seq
    if not idx:
        return None
    ys = [(w[1] + w[3]) / 2 for w in idx]
    gap = min([b - a for a, b in zip(ys, ys[1:]) if b - a > 4] or [12])
    per_col = [[] for _ in clusters]
    for w, cy in zip(idx, ys):
        row = [x for x in words if cy - gap / 2 <= (x[1] + x[3]) / 2 < cy + gap / 2 and x[1] >= hy1 - 0.5
               and left <= x[0] < right]
        name = clean(PUA_RE.sub("", " ".join(x[4] for x in sorted(row, key=lambda x: x[0])
                                              if w[2] < x[0] < cw[0] - 3 and x is not w)))
        name = re.sub(r"[.*]+$", "", name).strip()
        name = re.sub(r"^\(2-tone\)\s*", "2-tone ", name, flags=re.I)
        code = next((x[4].upper() for x in row if cw[0] - 8 <= x[0] < cw[2] + 12 and re.match(r"^[0-9A-Za-z]{3,4}$", x[4])), "")
        cells = sorted((x for x in row if x[0] >= cw[2] + 3 and re.match(r"^(Available|N/A)$", x[4])), key=lambda x: x[0])
        if not name or not cells or len(cells) > len(clusters):
            continue
        groups = _best_partition([(c[0] + c[2]) / 2 for c in cells], spans, len(cells))
        if not groups:
            continue
        for cell, (g0, g1) in zip(cells, groups):
            if cell[4] == "Available":
                for ci in range(g0, g1):
                    per_col[ci].append({"name": name, "code": code})
    return clusters, per_col


def colour_table(doc, descs):
    """-> per variant: [{"name", "code"}] from the price list's colour table, or None where it could not be read."""
    for page in doc:
        words = page.get_text("words")
        for cw in sorted((w for w in words if w[4] == "Code"), key=lambda w: (round(w[1]), w[0])):
            got = _table_at(page, words, cw, descs)
            if not got:
                continue
            clusters, per_col = got
            toks = [_tokens(c["text"]) for c in clusters]
            out = [None] * len(descs)
            for vi, d in enumerate(descs):
                dt = _tokens(d)
                best, score = None, 0
                for ci, ct in enumerate(toks):
                    if ct and ct <= dt and len(ct) > score:
                        best, score = ci, len(ct)
                if best is None and len(clusters) == len(descs):
                    best = vi
                if best is not None and per_col[best]:
                    out[vi] = per_col[best]
            if any(o is not None for o in out):  # this is the colour table (the accessories table never matches)
                return out
    return None


# -------------------------------------------------------------------- colours
def json_after(text, marker):
    m = re.search(marker + r"\s*=\s*", text)
    if not m:
        return None
    i = m.end()
    depth, j, in_str, esc = 0, i, False, False
    while j < len(text):
        c = text[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[i:j + 1])
        j += 1
    return None


CODE_TAIL = re.compile(r"\s*\(?\b([0-9][0-9A-Z]{2})\b\)?\s*$")


def split_colour(name):
    name = clean(name)
    m = CODE_TAIL.search(name)
    if m and re.search(r"[A-Za-z]", name[:m.start()]):
        return clean(name[:m.start()]), m.group(1)
    return name, ""


def hex_of(c):
    h = (c.get("colorCode") or {}).get("backgroundColor", "")
    return h.lower() if re.fullmatch(r"#[0-9a-fA-F]{6}", h or "") else ""


def colour_key(name):
    n = name.lower()
    n = re.sub(r"\bii\b", "2", n)
    n = re.sub(r"\bmc\b\.?", "mica", n)   # "MC." is Toyota's short form of "Mica"
    n = re.sub(r"\bdk\b\.?", "dark", n)
    return re.sub(r"[^a-z0-9]", "", n)


def variant_key(s):
    s = s.upper().replace("A/T", "AT").replace("M/T", "MT").replace("4X4", "4WD").replace("ROUGE", "ROGUE")
    s = re.sub(r"^TOYOTA ", "", s)
    return re.sub(r"[^A-Z0-9.]", "", s)


_page_cache = {}


def page_colours(path):
    """-> (general [(name, code, hex)], exclusive [(variant_name, name, code, hex)])"""
    if path in _page_cache:
        return _page_cache[path]
    html = fetch("%s/en/models/%s.html" % (BASE, path))
    dc = json_after(html, r"window\.data_colors")
    general, exclusive = [], []
    if dc:
        for o in dc.get("options", []):
            if o.get("id") != "exterior" and o.get("colorStyle") != "exterior":
                continue
            for c in o.get("colors", []):
                if c.get("colorName"):
                    nm, cd = split_colour(c["colorName"])
                    general.append((nm, cd, hex_of(c)))
            for c in o.get("variantColors", []):
                if c.get("colorName"):
                    nm, cd = split_colour(c["colorName"])
                    for v in c.get("exclusiveTo", []):
                        exclusive.append((v, nm, cd, hex_of(c)))
    _page_cache[path] = (general, exclusive)
    return _page_cache[path]


def colours_for(family, desc):
    cfg = COLOUR_PAGES.get(family)
    if not cfg:
        return []
    default, rules = cfg
    page = default
    for pat, p in rules:
        if re.search(pat, desc, re.I):
            page = p
            break
    general, exclusive = page_colours(page)
    out = list(general)
    dk = variant_key(desc)
    for v, nm, cd, hx in exclusive:
        if variant_key(v) == dk:
            out.append((nm, cd, hx))
    seen, res = set(), []
    for nm, cd, hx in out:
        k = colour_key(nm)
        if k and k not in seen:
            seen.add(k)
            res.append((nm, cd, hx))
    return res


# ----------------------------------------------------------------------- main
def main():
    old = {}
    if os.path.exists(OUT):
        try:
            old = {f["id"]: f for f in json.load(open(OUT, encoding="utf-8")).get("families", [])}
        except Exception:
            old = {}
    manual = {}
    if os.path.exists(MANUAL):
        manual = {colour_key(k): v.strip().upper() for k, v in json.load(open(MANUAL, encoding="utf-8")).items() if v}

    html = fetch(LIST_URL)
    links = pdf_links(html)
    log("price lists found:", len(links))
    if len(links) < 10:
        log("ERROR: fewer price lists than expected - the site layout may have changed. Nothing written.")
        return 1

    raw = {}  # family -> [{desc, code, colours:[(name, code)]}]
    problems = []
    for fam, path in sorted(links.items()):
        try:
            rows = parse_pdf(fetch(BASE + path, binary=True))
            for r in rows:
                try:
                    site = colours_for(fam, r["desc"])  # the model page: colour dots, and a fallback list
                except Exception as e:
                    site = []
                    log("      (model page not readable for %s: %s)" % (fam, e))
                if r.get("pdf_colours"):  # the price list is the authority for names, codes and availability
                    hexes = {colour_key(nm): hx for nm, cd, hx in site if hx}
                    r["colours"] = [(c["name"], c["code"], hexes.get(colour_key(c["name"]), "")) for c in r["pdf_colours"]]
                    r["from_pdf"] = True
                else:
                    r["colours"] = site
            raw[fam] = rows
            log("  ok  %-28s %d variants" % (fam, len(rows)))
        except Exception as e:
            problems.append(fam)
            log("  FAIL %-27s %s" % (fam, e))

    # colour codes: Toyota's own code if printed; else the same colour name's code elsewhere on the site; else manual list
    seen_codes = {}
    for rows in raw.values():
        for r in rows:
            for nm, cd, hx in r["colours"]:
                if cd:
                    seen_codes.setdefault(colour_key(nm), set()).add(cd)
    families = []
    filled = total = 0
    for fam, rows in raw.items():
        variants = []
        for r in rows:
            cols = []
            for nm, cd, hx in r["colours"]:
                k = colour_key(nm)
                code = manual.get(k) or cd or (next(iter(seen_codes[k])) if len(seen_codes.get(k, ())) == 1 else "")
                col = {"name": nm.upper(), "code": code}
                if hx:
                    col["hex"] = hx
                cols.append(col)
                total += 1
                filled += 1 if code else 0
            variants.append({"desc": r["desc"], "code": r["code"].upper(), "colours": cols})
        families.append({"id": fam, "model": LABELS.get(fam, fam.upper().replace("-", " ")), "variants": variants})
    for fam in problems:
        if fam in old:
            families.append(old[fam])
            log("  kept previous data for", fam)
    if len(families) < 10:
        log("ERROR: too few models parsed. Nothing written.")
        return 1
    families.sort(key=lambda f: f["model"])
    log("variants: %d   colours: %d (with a code: %d)" % (sum(len(f["variants"]) for f in families), total, filled))

    prev_families = json.load(open(OUT, encoding="utf-8")).get("families") if os.path.exists(OUT) else None
    if prev_families == families:
        log("no change - data/models.json left as is")
        return 0
    os.makedirs("data", exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"generated": datetime.date.today().isoformat(), "families": families}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    log("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
