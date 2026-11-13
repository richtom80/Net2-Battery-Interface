#!/usr/bin/env python3
"""
Build a printable battery-replacement worksheet (PDF) from the JSON that
`node scripts/dump-data.js` produces.

Usage:
    python scripts/make-report.py <input.json> <output.pdf>

Use "-" for <input.json> to read JSON from stdin, and "-" for <output.pdf>
to write the PDF to stdout (used by the dashboard's download button).

Each lock gets a row sorted worst-battery-first, colour-coded by status,
with blank "Date replaced" and "Initials" boxes to fill in on the walk.
"""
import json
import re
import sys
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Flowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT

INK = colors.HexColor("#16202E")
INK_SOFT = colors.HexColor("#5B6B7D")
LINE = colors.HexColor("#C3CCD6")
LINE_SOFT = colors.HexColor("#DCE2E9")
CRIT_BG = colors.HexColor("#FBE2E0")
CRIT = colors.HexColor("#C13329")
LOW_BG = colors.HexColor("#FBEFD6")
LOW = colors.HexColor("#A9700F")
OK_BG = colors.HexColor("#E3F3EB")
OK = colors.HexColor("#167A51")


def parse_name(raw):
    name = (raw or "").strip()
    m = re.search(r"[\{\(\[]\s*([^\{\}\(\)\[\]]+?)\s*[\}\)\]]", name)
    if m:
        loc = m.group(1)
    else:
        loc = re.sub(r"^\d+\s*-\s*", "", name)
        loc = re.sub(r"\bACU\s*\d+\b", "", loc, flags=re.I)
        loc = re.sub(r"\s{2,}", " ", loc).strip()
    fm = re.search(r"\b(GRD\s*FL|\d+\s*FL)\b", loc, flags=re.I)
    floor, rank, room = "", 99, loc
    if fm:
        f = fm.group(1).upper().replace(" ", "")
        floor = "GRD" if f == "GRDFL" else f
        rank = 0 if f == "GRDFL" else int(re.sub(r"\D", "", f))
        room = re.sub(r"\s{2,}", " ", loc.replace(fm.group(0), "")).strip()
    if not room:
        room = loc or name
    return room, floor, rank


def status(level):
    if level is None:
        return "ok"
    if level <= 2:
        return "critical"
    if level <= 4:
        return "low"
    return "ok"


class Rule(Flowable):
    def __init__(self, width, thickness=0.8, color=LINE):
        super().__init__()
        self.width = width
        self.thickness = thickness
        self.color = color

    def wrap(self, *a):
        return (self.width, self.thickness)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)


def build(data, out_path):
    levels = data.get("levels", [])
    rows = []
    for l in levels:
        room, floor, rank = parse_name(l.get("door"))
        lvl = l.get("batteryLevel")
        rows.append({
            "room": room, "floor": floor, "rank": rank,
            "level": 0 if lvl is None else lvl,
            "status": status(lvl),
            "serial": ("ACU " + str(l.get("serialNumber")).zfill(8)) if l.get("serialNumber") is not None else "",
        })
    rows.sort(key=lambda r: (r["level"], r["rank"], r["room"].lower()))

    counts = {"critical": 0, "low": 0, "ok": 0}
    for r in rows:
        counts[r["status"]] += 1

    try:
        synced = datetime.fromisoformat(data["fetchedAt"].replace("Z", "+00:00"))
        synced = synced.astimezone().strftime("%d %b %Y, %H:%M")
    except Exception:
        synced = "unknown"
    generated = datetime.now().astimezone().strftime("%d %b %Y, %H:%M")

    usable_w = A4[0] - 28 * mm
    styles = getSampleStyleSheet()
    cell = ParagraphStyle("cell", parent=styles["Normal"], fontName="Helvetica",
                          fontSize=9, leading=11, textColor=INK)
    cell_room = ParagraphStyle("room", parent=cell, fontName="Helvetica-Bold", fontSize=9.5)
    cell_serial = ParagraphStyle("serial", parent=cell, fontName="Courier", fontSize=7.5,
                                 textColor=INK_SOFT, leading=9)
    head = ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", fontSize=8.5,
                          textColor=colors.white)

    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK_SOFT)
        canvas.drawString(14 * mm, 10 * mm,
                          f"Generated {generated}  ·  data synced {synced}")
        canvas.drawRightString(A4[0] - 14 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm,
        title="Door Lock Battery Replacement Worksheet",
        author="Paxton Net2 Battery Monitor",
    )

    story = []
    title = Paragraph(
        "Door Lock Battery Replacement Worksheet",
        ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18,
                       textColor=INK, leading=21),
    )
    sub = Paragraph(
        f"Paxton Net2 wireless locks  ·  {len(rows)} locks  ·  data synced {synced}",
        ParagraphStyle("sub", fontName="Helvetica", fontSize=9.5,
                       textColor=INK_SOFT, leading=13, spaceBefore=2),
    )
    story += [title, sub, Spacer(1, 6), Rule(usable_w), Spacer(1, 10)]

    # Summary chips
    chip_data = [[
        Paragraph(f"<b>{counts['critical']}</b>  Critical &nbsp;(0–2)",
                  ParagraphStyle("c1", fontName="Helvetica", fontSize=10, textColor=CRIT)),
        Paragraph(f"<b>{counts['low']}</b>  Low &nbsp;(3–4)",
                  ParagraphStyle("c2", fontName="Helvetica", fontSize=10, textColor=LOW)),
        Paragraph(f"<b>{counts['ok']}</b>  Healthy &nbsp;(5–10)",
                  ParagraphStyle("c3", fontName="Helvetica", fontSize=10, textColor=OK)),
    ]]
    chip = Table(chip_data, colWidths=[usable_w / 3] * 3)
    chip.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), CRIT_BG),
        ("BACKGROUND", (1, 0), (1, 0), LOW_BG),
        ("BACKGROUND", (2, 0), (2, 0), OK_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEAFTER", (0, 0), (0, 0), 3, colors.white),
        ("LINEAFTER", (1, 0), (1, 0), 3, colors.white),
        ("BOX", (0, 0), (0, 0), 0.5, CRIT),
        ("BOX", (1, 0), (1, 0), 0.5, LOW),
        ("BOX", (2, 0), (2, 0), 0.5, OK),
    ]))
    story += [chip, Spacer(1, 14)]

    # Worksheet table
    col_w = [58 * mm, 14 * mm, 26 * mm, 16 * mm, 38 * mm, 20 * mm]
    labels = ["Location", "Floor", "ACU serial", "Battery", "Date replaced", "Initials"]
    table_data = [[Paragraph(x, head) for x in labels]]

    for r in rows:
        batt = Paragraph(
            f'<b>{r["level"]}</b> / 10',
            ParagraphStyle("b", fontName="Helvetica", fontSize=9,
                           textColor={"critical": CRIT, "low": LOW, "ok": OK}[r["status"]]),
        )
        table_data.append([
            Paragraph(r["room"], cell_room),
            Paragraph(r["floor"], cell),
            Paragraph(r["serial"], cell_serial),
            batt,
            "", "",
        ])

    table = Table(table_data, colWidths=col_w, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE_SOFT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, INK),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ]
    for i, r in enumerate(rows, start=1):
        if r["status"] == "critical":
            style.append(("BACKGROUND", (0, i), (3, i), CRIT_BG))
        elif r["status"] == "low":
            style.append(("BACKGROUND", (0, i), (3, i), LOW_BG))
    table.setStyle(TableStyle(style))
    story.append(table)

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    in_arg, out_arg = sys.argv[1], sys.argv[2]
    data = json.load(sys.stdin) if in_arg == "-" else json.load(open(in_arg))
    out = sys.stdout.buffer if out_arg == "-" else out_arg
    build(data, out)
    if out_arg != "-":
        print(f"Wrote {out_arg}")
