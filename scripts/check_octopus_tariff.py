import json
import os
import re
import smtplib
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

OCTOPUS_URL = "https://octopusenergy.it/offerta/tariffe"
MY_LOCKED_RATE = 0.1595  # Octopus Fissa 24M (OCTOFIX24v09)
STATE_FILE = Path("data/octopus_tariff.json")


def fetch_octopus_fissa_rate() -> Optional[float]:
    req = urllib.request.Request(
        OCTOPUS_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "it-IT,it;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    # Cerca i prezzi luce in €/kWh (es. 0,1727 €/kWh o 0.1727 €/kWh) nella pagina tariffe
    # Filtriamo valori realistici per la materia energia luce (tra 0.05 e 0.45 €/kWh)
    matches = re.findall(r"(0[.,]\d{3,4})\s*(?:€|&euro;)\s*/\s*kWh", html, re.IGNORECASE)
    candidates = []
    for raw in matches:
        try:
            val = float(raw.replace(",", "."))
            if 0.05 <= val <= 0.45:
                candidates.append(val)
        except ValueError:
            continue

    if not candidates:
        return None

    # Prende la tariffa fissa più bassa trovata sulla pagina tariffe Octopus
    return min(candidates)


def send_alert_email(current_rate: float) -> None:
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not gmail_user or not gmail_pass:
        print("Secrets GMAIL_USER o GMAIL_APP_PASSWORD mancanti: impossibile inviare email.")
        return

    diff_per_kwh = MY_LOCKED_RATE - current_rate
    est_saving_year = round(diff_per_kwh * 2300, 1)

    msg = EmailMessage()
    msg["Subject"] = (
        f"⚡ Octopus Fissa scesa a {current_rate:.4f} €/kWh (conviene cambiare!)"
    )
    msg["From"] = gmail_user
    msg["To"] = gmail_user
    msg.set_content(
        f"Ciao Maurizio,\n\n"
        f"La tariffa Octopus Energy su {OCTOPUS_URL} è scesa sotto il tuo prezzo bloccato!\n\n"
        f"- Nuova tariffa rilevata: {current_rate:.4f} €/kWh\n"
        f"- Tua tariffa attuale (Octopus Fissa 24M): {MY_LOCKED_RATE:.4f} €/kWh\n"
        f"- Risparmio: -{diff_per_kwh:.4f} €/kWh (~{est_saving_year:.0f} €/anno su 2.300 kWh)\n\n"
        f"Puoi verificare e chiedere il cambio tariffa gratuito dalla tua area Octopus:\n"
        f"{OCTOPUS_URL}\n"
    )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(gmail_user, gmail_pass)
        smtp.send_message(msg)
    print(f"Email di avviso inviata a {gmail_user} per tariffa {current_rate:.4f} €/kWh.")


def main() -> None:
    state = {
        "myLockedRate": MY_LOCKED_RATE,
        "currentRate": None,
        "lastAlertedRate": None,
        "updatedAt": None,
    }
    if STATE_FILE.exists():
        try:
            state.update(json.loads(STATE_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass

    current_rate = fetch_octopus_fissa_rate()
    if current_rate is None:
        print("Impossibile estrarre la tariffa €/kWh dalla pagina Octopus.")
        return

    print(
        f"Tariffa Octopus rilevata: {current_rate:.4f} €/kWh "
        f"(tua bloccata: {MY_LOCKED_RATE:.4f} €/kWh)"
    )

    state["myLockedRate"] = MY_LOCKED_RATE
    state["currentRate"] = current_rate
    state["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    last_alerted = state.get("lastAlertedRate")
    if current_rate < MY_LOCKED_RATE:
        if last_alerted is None or current_rate < float(last_alerted):
            send_alert_email(current_rate)
            state["lastAlertedRate"] = current_rate
        else:
            print(f"Avviso già inviato in precedenza per tariffa <= {last_alerted}.")
    else:
        print("Non conviene ancora cambiare: nessuna email inviata.")

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
