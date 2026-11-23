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
    return [{"desc": norm_desc(d), "code": c} for d, c in zip(descs, codes)]


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
                r["colours"] = colours_for(fam, r["desc"])
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
