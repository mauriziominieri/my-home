"""
Prelievo automatico del CSV reale di e-distribuzione dalla tua Gmail -> data/consumi.json.
Eseguito periodicamente da GitHub Actions (zero blocchi WAF / 403).

Secrets GitHub richiesti (solo 2):
  - GMAIL_USER: La tua email Google (es. mauminieri@gmail.com)
  - GMAIL_APP_PASSWORD: Password per le app di Google (16 caratteri)
"""

import csv
import email
import imaplib
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

POD_CODE = os.environ.get("POD_CODE", "IT001E11251419")
OUTPUT_FILE = Path("data/consumi.json")


def parse_it_float(raw: Optional[str]) -> float:
    if not raw:
        return 0.0
    cleaned = raw.strip().replace('"', "").replace(" ", "").replace(",", ".")
    try:
        val = float(cleaned)
        return round(val, 2) if val >= 0 else 0.0
    except ValueError:
        return 0.0


def normalize_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.strip().replace('"', "")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", cleaned):
        return cleaned
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", cleaned)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def parse_csv_content(text: str) -> List[Dict[str, Any]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []

    # Trova la riga di intestazione contenente 'data' o 'giorno'
    header_idx = 0
    for idx, ln in enumerate(lines[:15]):
        low = ln.lower()
        if "data" in low or "giorno" in low or "date" in low:
            header_idx = idx
            break

    delimiter = ";" if ";" in lines[header_idx] else ","
    reader = csv.reader(lines[header_idx:], delimiter=delimiter)
    headers = [h.strip().lower().replace('"', "") for h in next(reader, [])]

    def find_col(keywords: List[str]) -> int:
        for i, h in enumerate(headers):
            if any(k in h for k in keywords):
                return i
        return -1

    date_idx = find_col(["data", "giorno", "date"])
    f1_idx = find_col(["f1"])
    f2_idx = find_col(["f2"])
    f3_idx = find_col(["f3"])
    tot_idx = find_col(["tot", "kwh", "consumo", "energia"])
    peak_idx = find_col(["picco", "potenza", "kw"])

    if date_idx == -1:
        return []

    by_date: Dict[str, Dict[str, Any]] = {}

    for row in reader:
        if len(row) <= date_idx:
            continue
        iso = normalize_date(row[date_idx])
        if not iso:
            continue

        f1 = parse_it_float(row[f1_idx]) if f1_idx != -1 and len(row) > f1_idx else 0.0
        f2 = parse_it_float(row[f2_idx]) if f2_idx != -1 and len(row) > f2_idx else 0.0
        f3 = parse_it_float(row[f3_idx]) if f3_idx != -1 and len(row) > f3_idx else 0.0
        tot = round(f1 + f2 + f3, 2)

        if tot == 0.0 and tot_idx != -1 and len(row) > tot_idx:
            tot = parse_it_float(row[tot_idx])
            f3 = tot

        peak = parse_it_float(row[peak_idx]) if peak_idx != -1 and len(row) > peak_idx else 0.0

        # Se il CSV ha righe quartorarie/orarie per la stessa data, somma i kWh del giorno
        if iso in by_date:
            prev = by_date[iso]
            prev["f1Kwh"] = round(prev["f1Kwh"] + f1, 2)
            prev["f2Kwh"] = round(prev["f2Kwh"] + f2, 2)
            prev["f3Kwh"] = round(prev["f3Kwh"] + f3, 2)
            prev["totalKwh"] = round(prev["totalKwh"] + tot, 2)
            prev["peakKw"] = round(max(prev["peakKw"], min(6.0, peak)), 2)
        else:
            by_date[iso] = {
                "date": iso,
                "f1Kwh": f1,
                "f2Kwh": f2,
                "f3Kwh": f3,
                "totalKwh": tot,
                "peakKw": min(6.0, peak),
            }

    return list(by_date.values())


def extract_csvs_from_gmail() -> List[Dict[str, Any]]:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        raise RuntimeError("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti su GitHub.")

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_user, gmail_pass)
    mail.select("INBOX")

    # Cerca email da e-distribuzione (o con oggetto contenente e-distribuzione / misure / consumi)
    status, data = mail.search(None, '(OR FROM "e-distribuzione" SUBJECT "e-distribuzione")')
    if status != "OK" or not data or not data[0]:
        mail.logout()
        print("Nessuna email di e-distribuzione trovata nella casella INBOX.")
        return []

    msg_ids = data[0].split()[-10:]  # Ultime 10 email ricevute
    all_readings: List[Dict[str, Any]] = []

    for msg_id in msg_ids:
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        if not msg_data or not isinstance(msg_data[0], tuple):
            continue
        msg = email.message_from_bytes(msg_data[0][1])

        for part in msg.walk():
            filename = (part.get_filename() or "").lower()
            if not filename:
                continue

            payload = part.get_payload(decode=True)
            if not payload:
                continue

            if filename.endswith(".csv"):
                text = payload.decode("utf-8-sig", errors="replace")
                all_readings.extend(parse_csv_content(text))
            elif filename.endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".csv"):
                            text = zf.read(name).decode("utf-8-sig", errors="replace")
                            all_readings.extend(parse_csv_content(text))

    mail.logout()
    return all_readings


def main() -> None:
    print(f"Controllo Gmail per allegati CSV e-distribuzione (POD {POD_CODE})...")
    new_readings = extract_csvs_from_gmail()

    existing_by_date: Dict[str, Dict[str, Any]] = {}
    if OUTPUT_FILE.exists():
        try:
            old_data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            for item in old_data.get("readings", []):
                if "date" in item:
                    existing_by_date[item["date"]] = item
        except Exception:
            pass

    for item in new_readings:
        existing_by_date[item["date"]] = item

    merged = sorted(existing_by_date.values(), key=lambda x: x["date"])

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "pod": POD_CODE,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "readings": merged,
    }
    OUTPUT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Completato: {len(new_readings)} letture estratte da Gmail, {len(merged)} giorni totali salvati.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Errore sync Gmail e-distribuzione: {exc}", file=sys.stderr)
        sys.exit(1)
