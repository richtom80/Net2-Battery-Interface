#!/usr/bin/env python3
"""
Build an access-audit PDF (by-user or by-door) from JSON on stdin, writing
the PDF to stdout. Driven by the dashboard's "Download PDF" buttons.

Input JSON:
  { "kind": "user", "generatedAt": "...",
    "user": {"name": "...", "accessLevel": "...", "department": "..."},
    "rows": [ {"serialNumber": 123, "peripheralName": "...", "timezones": [..]} ] }

  { "kind": "door", "generatedAt": "...",
    "rows": [ {"serialNumber": 123, "peripheralName": "...",
               "userCount": 9, "users": "A, B, C"} ] }

Usage: python scripts/make-access-report.py < input.json > out.pdf
"""
import json
import re
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Flowable
from reportlab.lib.styles import ParagraphStyle

INK = colors.HexColor("#16202E")
INK_SOFT = colors.HexColor("#5B6B7D")
INK_FAINT = colors.HexColor("#8A98A8")
LINE = colors.HexColor("#C3CCD6")
LINE_SOFT = colors.HexColor("#DCE2E9")
CHIP_BG = colors.HexColor("#EEF2F6")


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


def serial_text(n):
    return ("ACU " + str(n).zfill(8)) if n is not None else ""


class Rule(Flowable):
    def __init__(self, width, thickness=0.8, color=LINE):
        super().__init__()
        self.width, self.thickness, self.color = width, thickness, color

    def wrap(self, *a):
        return (self.width, self.thickness)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)


def fmt_dt(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d %b %Y, %H:%M")
    except Exception:
        return "unknown"


def build(data, out):
    kind = data.get("kind")
    usable_w = A4[0] - 28 * mm
    generated = datetime.now().astimezone().strftime("%d %b %Y, %H:%M")

    cell = ParagraphStyle("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
    cell_room = ParagraphStyle("room", parent=cell, fontName="Helvetica-Bold", fontSize=9.5)
    cell_serial = ParagraphStyle("serial", parent=cell, fontName="Courier", fontSize=7.5, textColor=INK_SOFT, leading=9)
    cell_users = ParagraphStyle("users", parent=cell, fontSize=8.5, leading=11, textColor=INK_SOFT)
    head = ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white)

    if kind == "user":
        u = data.get("user", {})
        title_text = "Door Access by User"
        sub_text = u.get("name", "Unknown user")
        meta_bits = []
        if u.get("accessLevel"):
            meta_bits.append("Access level: " + u["accessLevel"])
        if u.get("department"):
            meta_bits.append(u["department"])
        meta_text = "  ·  ".join(meta_bits)
    elif kind == "review":
        title_text = "Access Review"
        sub_text = "Active users by how long since a credential was last used"
        meta_text = data.get("filterLabel", "")
    else:
        title_text = "Door Access Audit"
        sub_text = "All doors and the users who can open them"
        meta_text = ""

    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK_SOFT)
        canvas.drawString(14 * mm, 10 * mm, f"Generated {generated}")
        canvas.drawRightString(A4[0] - 14 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        out, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm, title=title_text,
        author="Paxton Net2 Battery Interface",
    )

    story = [
        Paragraph(title_text, ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=18, textColor=INK, leading=21)),
        Paragraph(sub_text, ParagraphStyle("s", fontName="Helvetica-Bold", fontSize=12, textColor=INK, leading=16, spaceBefore=3)),
    ]
    if meta_text:
        story.append(Paragraph(meta_text, ParagraphStyle("m", fontName="Helvetica", fontSize=9.5, textColor=INK_SOFT, leading=13)))
    story += [Spacer(1, 8), Rule(usable_w), Spacer(1, 12)]

    rows = data.get("rows", [])

    if kind == "review":
        col_w = [52 * mm, 50 * mm, 44 * mm, usable_w - 146 * mm]
        table_data = [[Paragraph(x, head) for x in ["User", "Department", "Access level", "Last used"]]]
        for r in rows:
            days = r.get("daysSince")
            if r.get("lastAccess"):
                try:
                    d = datetime.fromisoformat(r["lastAccess"].replace("Z", "+00:00")).astimezone().strftime("%d %b %Y")
                except Exception:
                    d = "unknown"
                last = f'{d}<br/><font size="7.5" color="#8A98A8">{days} day{"" if days == 1 else "s"} ago</font>'
            else:
                last = '<font color="#C13329">Never used</font>'
            table_data.append([
                Paragraph(r.get("name") or "", cell_room),
                Paragraph(r.get("department") or "—", cell),
                Paragraph(r.get("accessLevel") or "—", cell),
                Paragraph(last, cell),
            ])
        summary = f"{len(rows)} user{'' if len(rows) == 1 else 's'}"
        story.insert(len(story), Paragraph(summary, ParagraphStyle("sum", fontName="Helvetica", fontSize=9.5, textColor=INK_SOFT, spaceAfter=10)))
        table = Table(table_data, colWidths=col_w, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 1), (-1, -1), 7), ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE_SOFT),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, INK),
            ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ]))
        story.append(table)
        doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
        return

    parsed = []
    for r in rows:
        room, floor, rank = parse_name(r.get("peripheralName"))
        parsed.append((rank, room, floor, r))
    parsed.sort(key=lambda x: (x[0], x[1].lower()))

    if kind == "user":
        col_w = [78 * mm, 18 * mm, usable_w - 96 * mm]
        table_data = [[Paragraph(x, head) for x in ["Door", "Floor", "Access window"]]]
        for rank, room, floor, r in parsed:
            doorp = Paragraph(f'{room}<br/><font name="Courier" size="7.5" color="#5B6B7D">{serial_text(r.get("serialNumber"))}</font>', cell_room)
            tz = ", ".join(r.get("timezones") or []) or "—"
            table_data.append([doorp, Paragraph(floor, cell), Paragraph(tz, cell)])
        summary = f"{len(parsed)} door{'' if len(parsed) == 1 else 's'} accessible"
    else:
        col_w = [60 * mm, 16 * mm, usable_w - 76 * mm]
        table_data = [[Paragraph(x, head) for x in ["Door", "Floor", "Users with access"]]]
        total_doors = len(parsed)
        for rank, room, floor, r in parsed:
            doorp = Paragraph(f'{room}<br/><font name="Courier" size="7.5" color="#5B6B7D">{serial_text(r.get("serialNumber"))}</font>', cell_room)
            n = r.get("userCount") or 0
            users = r.get("users") or "—"
            usersp = Paragraph(f'<b>{n}</b> &nbsp; {users}', cell_users)
            table_data.append([doorp, Paragraph(floor, cell), usersp])
        summary = f"{total_doors} door{'' if total_doors == 1 else 's'}"

    story.insert(len(story), Paragraph(summary, ParagraphStyle("sum", fontName="Helvetica", fontSize=9.5, textColor=INK_SOFT, spaceAfter=10)))

    table = Table(table_data, colWidths=col_w, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 7), ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE_SOFT),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, INK),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ]))
    story.append(table)
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


if __name__ == "__main__":
    data = json.load(sys.stdin)
    build(data, sys.stdout.buffer)
