import html as html_lib
import json
import os
import re
import smtplib
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List, Optional

OCTOPUS_URL = "https://octopusenergy.it/offerta/tariffe"
MY_LOCKED_RATE = 0.1595  # Octopus Fissa 24M (OCTOFIX24v09)
MY_FIXED_EUR_MONTH = 6.0  # 72 EUR/anno (6 EUR/mese)
ANNUAL_KWH_BENCHMARK = 2300.0
MIN_ANNUAL_SAVING_EUR = 5.0
STATE_FILE = Path("data/octopus_tariff.json")

SUPPLIER_TARGETS: List[Dict[str, Any]] = [
    {
        "supplier": "Octopus Energy",
        "offerName": "Octopus Fissa 12M / 24M",
        "url": "https://octopusenergy.it/offerta/tariffe",
        "defaultFixedEurMonth": 6.0,
    },
    {
        "supplier": "Eni Plenitude",
        "offerName": "Fixa Time Luce",
        "url": "https://eniplenitude.com/offerta/casa/gas-e-luce/fixa-time",
        "defaultFixedEurMonth": 12.0,
    },
    {
        "supplier": "E.ON Energia",
        "offerName": "LuceClick Verde",
        "url": "https://www.eon-energia.com/luce/casa/eon-luceclick.html",
        "defaultFixedEurMonth": 9.0,
    },
    {
        "supplier": "NeN",
        "offerName": "Luce Special / Fissa",
        "url": "https://nen.it/offerta-luce",
        "defaultFixedEurMonth": 8.0,
    },
    {
        "supplier": "Sorgenia",
        "offerName": "Next Energy Sunlight / Smart",
        "url": "https://www.sorgenia.it/offerta-luce-e-gas",
        "defaultFixedEurMonth": 9.5,
    },
    {
        "supplier": "Enel Energia",
        "offerName": "Enel Fix Web Luce",
        "url": "https://www.enel.it/it/luce-e-gas/luce/offerte/enel-fix-web-luce",
        "defaultFixedEurMonth": 10.0,
    },
]


def fetch_html(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean_visible_text(raw_html: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", " ", raw_html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text)


def extract_rate_and_fixed(raw_html: str, default_fixed: float) -> tuple[Optional[float], float]:
    # Estrae prezzi €/kWh sia dal markup HTML sia dal testo pulito
    candidates: List[float] = []
    for source_text in (raw_html, clean_visible_text(raw_html)):
        matches = re.findall(r"(0[.,]\d{3,4})\s*(?:€|&euro;|EUR)\s*/\s*kWh", source_text, re.IGNORECASE)
        for raw in matches:
            try:
                val = float(raw.replace(",", "."))
                if 0.06 <= val <= 0.40:
                    candidates.append(val)
            except ValueError:
                continue

    rate = min(candidates) if candidates else None

    fixed_candidates: List[float] = []
    visible = clean_visible_text(raw_html)
    for pat in (
        r"(\d{1,2}(?:[.,]\d{1,2})?)\s*€\s*/\s*mese",
        r"commercializzazione[^0-9]{0,40}(\d{2,3}(?:[.,]\d{1,2})?)\s*€\s*/?\s*anno",
    ):
        for idx, m in enumerate(re.findall(pat, visible, re.IGNORECASE)):
            try:
                val = float(m.replace(",", "."))
                if "anno" in pat and val >= 36:
                    val = round(val / 12.0, 2)
                if 3.0 <= val <= 20.0:
                    fixed_candidates.append(val)
            except ValueError:
                continue

    fixed = min(fixed_candidates) if fixed_candidates else default_fixed
    return rate, round(fixed, 2)


def scrape_supplier(target: Dict[str, Any]) -> Dict[str, Any]:
    try:
        raw_html = fetch_html(target["url"])
        rate, fixed = extract_rate_and_fixed(raw_html, float(target["defaultFixedEurMonth"]))
        if rate is None:
            return {
                "supplier": target["supplier"],
                "offerName": target["offerName"],
                "rateEurKwh": None,
                "fixedEurMonth": fixed,
                "estAnnualEur": None,
                "url": target["url"],
                "status": "unavailable",
            }
        est_annual = round(rate * ANNUAL_KWH_BENCHMARK + fixed * 12.0, 2)
        return {
            "supplier": target["supplier"],
            "offerName": target["offerName"],
            "rateEurKwh": round(rate, 4),
            "fixedEurMonth": fixed,
            "estAnnualEur": est_annual,
            "url": target["url"],
            "status": "ok",
        }
    except Exception as exc:
        print(f"Impossibile leggere {target['supplier']}: {exc}")
        return {
            "supplier": target["supplier"],
            "offerName": target["offerName"],
            "rateEurKwh": None,
            "fixedEurMonth": float(target["defaultFixedEurMonth"]),
            "estAnnualEur": None,
            "url": target["url"],
            "status": "unavailable",
        }


def send_alert_email(best_offer: Dict[str, Any], my_annual: float) -> None:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        print("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti: impossibile inviare email.")
        return

    est_saving = round(my_annual - float(best_offer["estAnnualEur"]), 2)
    msg = EmailMessage()
    msg["Subject"] = (
        f"⚡ Offerta luce migliore trovata: {best_offer['supplier']} a "
        f"{best_offer['rateEurKwh']:.4f} €/kWh (-{est_saving:.0f} €/anno)"
    )
    msg["From"] = gmail_user
    msg["To"] = gmail_user
    msg.set_content(
        f"Ciao Maurizio,\n\n"
        f"Il monitor automatico ha rilevato una tariffa luce più conveniente rispetto al tuo contratto attuale!\n\n"
        f"- Migliore offerta rilevata: {best_offer['supplier']} — {best_offer['offerName']}\n"
        f"- Prezzo energia: {best_offer['rateEurKwh']:.4f} €/kWh (fisso {best_offer['fixedEurMonth']:.2f} €/mese)\n"
        f"- Stima annua su {int(ANNUAL_KWH_BENCHMARK)} kWh: {best_offer['estAnnualEur']:.2f} €/anno\n\n"
        f"- Tua offerta attuale (Octopus Fissa 24M): {MY_LOCKED_RATE:.4f} €/kWh "
        f"(fisso {MY_FIXED_EUR_MONTH:.2f} €/mese -> {my_annual:.2f} €/anno)\n"
        f"- Risparmio annuo stimato: ~{est_saving:.2f} €/anno\n\n"
        f"Verifica i dettagli e le CTE ufficiali qui:\n"
        f"{best_offer['url']}\n"
    )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(gmail_user, gmail_pass)
        smtp.send_message(msg)
    print(f"Email di avviso inviata a {gmail_user} per {best_offer['supplier']}.")


def main() -> None:
    state: Dict[str, Any] = {
        "myLockedRate": MY_LOCKED_RATE,
        "myFixedEurMonth": MY_FIXED_EUR_MONTH,
        "currentRate": None,
        "lastAlertedRate": None,
        "lastAlertedKey": None,
        "competitors": [],
        "bestCompetitor": None,
        "updatedAt": None,
    }
    if STATE_FILE.exists():
        try:
            state.update(json.loads(STATE_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass

    competitors = [scrape_supplier(target) for target in SUPPLIER_TARGETS]
    octopus_offer = next((c for c in competitors if c["supplier"] == "Octopus Energy"), None)
    current_rate = octopus_offer["rateEurKwh"] if octopus_offer and octopus_offer["rateEurKwh"] is not None else state.get("currentRate")

    valid_offers = [c for c in competitors if c["status"] == "ok" and c["estAnnualEur"] is not None]
    best_offer = min(valid_offers, key=lambda c: float(c["estAnnualEur"])) if valid_offers else None

    my_annual = round(MY_LOCKED_RATE * ANNUAL_KWH_BENCHMARK + MY_FIXED_EUR_MONTH * 12.0, 2)
    print(f"Tuo costo annuo stimato (Octopus Fissa 24M): {my_annual:.2f} €/anno")
    for c in competitors:
        print(
            f" - {c['supplier']}: "
            + (f"{c['rateEurKwh']:.4f} €/kWh + {c['fixedEurMonth']:.2f} €/m -> {c['estAnnualEur']:.2f} €/anno" if c["status"] == "ok" else "non disponibile")
        )

    state["myLockedRate"] = MY_LOCKED_RATE
    state["myFixedEurMonth"] = MY_FIXED_EUR_MONTH
    state["currentRate"] = current_rate
    state["competitors"] = competitors
    state["bestCompetitor"] = best_offer
    state["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if best_offer and (my_annual - float(best_offer["estAnnualEur"])) >= MIN_ANNUAL_SAVING_EUR:
        alert_key = f"{best_offer['supplier']}|{best_offer['rateEurKwh']}|{best_offer['fixedEurMonth']}"
        if state.get("lastAlertedKey") != alert_key:
            send_alert_email(best_offer, my_annual)
            state["lastAlertedKey"] = alert_key
            if best_offer["supplier"] == "Octopus Energy":
                state["lastAlertedRate"] = best_offer["rateEurKwh"]
        else:
            print(f"Avviso già inviato per {alert_key}.")
    else:
        print("Nessun fornitore batte sensibilmente la tua Octopus Fissa 24M attuale.")

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
