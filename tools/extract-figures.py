"""Extract the embedded figures from Refactoring UI.

The text extraction captured 111KB of prose but none of the 284 figures, and in this book the
figures carry most of the teaching: the spacing scale, the colour shade ramps, the two-part
shadow recipe, before/after pairs. A rubric built from prose alone can only say "use 5+ shades";
the figure says WHICH shades.

No heavy dependencies: pypdf already yields the embedded PNGs at full resolution (1480px wide).

Usage:
    py -3 tools/extract-figures.py            # all pages with figures
    py -3 tools/extract-figures.py 73 149 150 # specific pages
"""
import sys, os, json
from pypdf import PdfReader

SRC = r"C:\Users\effen\.dsh\attachments\v1\files\c6\c6df5ef9c14f153a301bfcc663d88167c8b90e5a94fe340b6f009c114a7b9d2e\8724ae996f4390f885086d121a70e40a.pdf"
OUT = r"F:\Work\uih\docs\reference\figures"

os.makedirs(OUT, exist_ok=True)
r = PdfReader(SRC)

want = [int(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else None

manifest = []
for pageno, page in enumerate(r.pages, start=1):
    if want and pageno not in want:
        continue
    try:
        images = list(page.images)
    except Exception as e:
        print(f"page {pageno}: image read failed: {e}")
        continue
    for idx, im in enumerate(images):
        # Only keep figures big enough to be a real diagram rather than an inline glyph.
        try:
            w, h = im.image.size
        except Exception:
            continue
        if w < 120 or h < 60:
            continue
        name = f"p{pageno:03d}-{idx}.png"
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(im.data)
        manifest.append({"page": pageno, "file": name, "w": w, "h": h})

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

print(f"extracted {len(manifest)} figures from {len(set(m['page'] for m in manifest))} pages")
print(f"largest: {sorted(manifest, key=lambda m: -m['w']*m['h'])[:3]}")
