"""
Prelievo automatico del CSV "Dettaglio curve di carico" (FORNUTAIT...csv) da Gmail -> data/consumi.json.
Mittente: notifichemailped@enel.com | Oggetto: Dettaglio curve di carico
Supporta qualsiasi formato di data (D/M/YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) e
qualsiasi intestazione quartoraria (00:00 - 00:15, 00:15, Q1..Q96, 1..96).
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
        return val if val >= 0 else 0.0
    except ValueError:
        return 0.0


def normalize_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    cleaned = raw.strip().replace('"', "").split(" ")[0]
    # YYYY-MM-DD or YYYY/MM/DD
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", cleaned)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    # DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", cleaned)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    # YYYYMMDD
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", cleaned)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def get_arera_band(iso_date: str, hour: int) -> str:
    """Calcola fascia ARERA (F1, F2, F3) in base al giorno della settimana e all'ora (0-23)."""
    dt = datetime.strptime(iso_date, "%Y-%m-%d")
    weekday = dt.weekday()  # 0=Lun .. 5=Sab, 6=Dom
    if weekday == 6:
        return "F3"
    if weekday == 5:
        return "F2" if 7 <= hour < 23 else "F3"
    if 8 <= hour < 19:
        return "F1"
    if (7 <= hour < 8) or (19 <= hour < 23):
        return "F2"
    return "F3"


def parse_csv_content(text: str) -> List[Dict[str, Any]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []

    delimiter = ";" if lines[0].count(";") >= lines[0].count(",") else ","
    # Controlla anche le righe successive nel caso ci siano righe di intestazione/metadati in alto
    for ln in lines[:10]:
        if ln.count(";") >= 10:
            delimiter = ";"
            break

    results: List[Dict[str, Any]] = []
    reader = list(csv.reader(lines, delimiter=delimiter))

    # Scansiona tutte le righe: appena trova una riga che inizia con una data valida
    # e ha almeno 24 colonne numeriche, la elabora come curva di carico quartoraria/oraria!
    for row in reader:
        if len(row) < 2:
            continue

        # Cerca la colonna della data nelle prime 3 colonne
        date_idx = -1
        iso = None
        for idx in range(min(3, len(row))):
            cand = normalize_date(row[idx])
            if cand:
                date_idx = idx
                iso = cand
                break

        if not iso or date_idx == -1:
            continue

        value_cells = row[date_idx + 1 :]
        # Caso 1: Curva di carico quartoraria (96 colonne) o oraria (24 colonne)
        if len(value_cells) >= 24:
            is_hourly = len(value_cells) < 48
            f1 = 0.0
            f2 = 0.0
            f3 = 0.0
            max_slot = 0.0

            for slot_idx, cell in enumerate(value_cells[:96]):
                val = parse_it_float(cell)
                if val > max_slot:
                    max_slot = val
                hour = slot_idx if is_hourly else min(23, slot_idx // 4)
                band = get_arera_band(iso, hour)
                if band == "F1":
                    f1 += val
                elif band == "F2":
                    f2 += val
                else:
                    f3 += val

            f1 = round(f1, 2)
            f2 = round(f2, 2)
            f3 = round(f3, 2)
            tot = round(f1 + f2 + f3, 2)
            peak_kw = round(min(6.0, max_slot if is_hourly else max_slot * 4.0), 2)

            results.append(
                {
                    "date": iso,
                    "f1Kwh": f1,
                    "f2Kwh": f2,
                    "f3Kwh": f3,
                    "totalKwh": tot,
                    "peakKw": peak_kw,
                }
            )
        else:
            # Caso 2: Riga compatta con F1, F2, F3 o Totale
            nums = [parse_it_float(c) for c in value_cells if c.strip()]
            if not nums:
                continue
            if len(nums) >= 3:
                f1, f2, f3 = round(nums[0], 2), round(nums[1], 2), round(nums[2], 2)
                tot = round(f1 + f2 + f3, 2)
            else:
                f1, f2, f3 = 0.0, 0.0, round(nums[0], 2)
                tot = f3
            results.append(
                {
                    "date": iso,
                    "f1Kwh": f1,
                    "f2Kwh": f2,
                    "f3Kwh": f3,
                    "totalKwh": tot,
                    "peakKw": 0.0,
                }
            )

    if not results:
        print(f"DEBUG prime 2 righe CSV non riconosciute: {lines[:2]}")

    return results


def extract_csvs_from_gmail() -> List[Dict[str, Any]]:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        raise RuntimeError("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti su GitHub.")

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(gmail_user, gmail_pass)
    mail.select("INBOX")

    status, data = mail.search(
        None,
        '(OR FROM "notifichemailped@enel.com" SUBJECT "Dettaglio curve di carico")',
    )
    if status != "OK" or not data or not data[0]:
        mail.logout()
        print("Nessuna email 'Dettaglio curve di carico' trovata nella INBOX.")
        return []

    msg_ids = data[0].split()[-15:]
    print(f"Trovate {len(msg_ids)} email di e-distribuzione / Enel.")
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
                print(f"Elaborazione allegato CSV: {filename}")
                text = payload.decode("utf-8-sig", errors="replace")
                all_readings.extend(parse_csv_content(text))
            elif filename.endswith(".zip"):
                print(f"Elaborazione allegato ZIP: {filename}")
                with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                    for name in zf.namelist():
                        if name.lower().endswith(".csv"):
                            text = zf.read(name).decode("utf-8-sig", errors="replace")
                            all_readings.extend(parse_csv_content(text))

    mail.logout()
    return all_readings


def main() -> None:
    print(f"Controllo Gmail per 'Dettaglio curve di carico' (POD {POD_CODE})...")
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
    print(f"Completato: {len(new_readings)} giorni estratti da Gmail, {len(merged)} giorni totali salvati.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Errore sync Gmail e-distribuzione: {exc}", file=sys.stderr)
        sys.exit(1)
