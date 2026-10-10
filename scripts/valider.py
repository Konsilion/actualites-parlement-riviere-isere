#!/usr/bin/env python3
"""Validation des actualités proposées : pending → CSV → commit/push.

Usage :
    python3 scripts/valider.py 1 3        # valide les propositions n° 1 et 3
    python3 scripts/valider.py --liste     # affiche les propositions en attente
    python3 scripts/valider.py 2 --no-push # valide sans pousser (test local)

Comportement :
- lit data/pending_proposals.json (propositions numérotées),
- déplace les propositions validées vers data/actualites.csv avec un id
  unique et la date_ajout du jour,
- garde anti-doublon : refuse un message_id ou un lien déjà présent dans
  le CSV, refuse un titre déjà présent,
- retire les propositions validées du pending, commit et pousse (sauf
  --no-push) → GitHub Pages resert en ~2 min.

Aucune invention : les champs viennent tels quels du pending.
"""
import csv
import json
import subprocess
import sys
import datetime
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PENDING = REPO / "data" / "pending_proposals.json"
CSV = REPO / "data" / "actualites.csv"

HEADERS = [
    "id", "date_ajout", "type", "titre", "description",
    "date_debut", "date_fin", "lieu", "lien", "source_message_id",
]

VALID_TYPES = {
    "evenement_a_venir", "ressource_publiee", "evenement_passe",
    "information_parlement",
}


def run_git(*args, check=True):
    return subprocess.run(
        ["git", "-C", str(REPO), *args],
        capture_output=True, text=True, check=check,
    )


def read_pending():
    with open(PENDING, encoding="utf-8") as f:
        return json.load(f)


def read_csv_rows():
    if not CSV.exists() or CSV.stat().st_size == 0:
        return []
    with open(CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def next_id(rows):
    nums = []
    for r in rows:
        m = re.match(r"A(\d+)", r.get("id", ""))
        if m:
            nums.append(int(m.group(1)))
    return f"A{(max(nums) + 1) if nums else 1:04d}"


def normalize_mid(mid):
    mid = (mid or "").strip()
    if mid.startswith("<") and mid.endswith(">"):
        mid = mid[1:-1]
    return mid


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if args[0] == "--liste":
        return do_list()

    numbers = []
    no_push = "--no-push" in args
    for a in args:
        if a == "--no-push":
            continue
        if not a.isdigit():
            print(f"ERREUR : argument invalide {a!r} (numéros attendus)")
            return 2
        numbers.append(int(a))

    pending = read_pending()
    props = pending.get("propositions", [])
    by_num = {p.get("numero"): p for p in props}

    missing = [n for n in numbers if n not in by_num]
    if missing:
        print(f"ERREUR : numéro(s) absent(s) du pending : {missing}")
        print(f"Numéros disponibles : {sorted(by_num)}")
        return 2

    rows = read_csv_rows()
    existing_mids = {normalize_mid(r.get("source_message_id", "")) for r in rows}
    existing_mids.discard("")
    existing_links = {r.get("lien", "").strip() for r in rows}
    existing_links.discard("")
    existing_titles = {r.get("titre", "").strip() for r in rows}

    today = datetime.date.today().isoformat()
    validated = []
    rejected = []
    for n in numbers:
        p = by_num[n]
        mid = normalize_mid(p.get("source_message_id", ""))
        lien = (p.get("lien") or "").strip()
        titre = (p.get("titre") or "").strip()
        typ = (p.get("type") or "").strip()
        if typ not in VALID_TYPES:
            rejected.append((n, "type inconnu"))
            continue
        if mid and mid in existing_mids:
            rejected.append((n, "message_id déjà dans le CSV"))
            continue
        if lien and lien in existing_links:
            rejected.append((n, "lien déjà dans le CSV"))
            continue
        if titre and titre in existing_titles:
            rejected.append((n, "titre déjà dans le CSV"))
            continue
        rows.append({
            "id": next_id(rows),
            "date_ajout": today,
            "type": typ,
            "titre": titre,
            "description": (p.get("resume") or "").strip(),
            "date_debut": (p.get("date_debut") or "").strip(),
            "date_fin": (p.get("date_fin") or "").strip(),
            "lieu": (p.get("lieu") or "").strip(),
            "lien": lien,
            "source_message_id": mid,
        })
        existing_mids.add(mid)
        existing_links.add(lien)
        existing_titles.add(titre)
        validated.append((n, titre))

    # écriture du CSV (module csv : quotes/virgules gérés, UTF-8)
    with open(CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS)
        w.writeheader()
        w.writerows(rows)

    # retrait des propositions validées du pending
    pending["propositions"] = [
        p for p in props if p.get("numero") not in numbers
    ]
    with open(PENDING, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)

    for n, t in validated:
        print(f"VALIDÉ  n°{n} : {t}")
    for n, r in rejected:
        print(f"REFUSÉ  n°{n} : {r}")

    if not validated:
        print("Aucune actualité validée — pas de commit.")
        return 1 if rejected else 0

    # commit + push
    run_git("add", "data/actualites.csv", "data/pending_proposals.json")
    run_git("commit", "-m", f"actualités : validation CEO de {len(validated)} carte(s)")
    if no_push:
        print("Commit local effectué (--no-push : pas de push).")
    else:
        r = run_git("push")
        print("Push OK" if r.returncode == 0 else f"Push ÉCHEC : {r.stderr}")
        return 1 if r.returncode else 0
    return 0


def do_list():
    pending = read_pending()
    props = pending.get("propositions", [])
    if not props:
        print("Aucune proposition en attente.")
        return 0
    print(f"{len(props)} proposition(s) en attente (data/pending_proposals.json) :")
    for p in props:
        print(f"\n  {p.get('numero')}. {p.get('titre')}")
        print(f"     type        : {p.get('type')}")
        dates = p.get("date_debut") or "—"
        if p.get("date_fin"):
            dates += f" → {p.get('date_fin')}"
        print(f"     dates       : {dates} {p.get('heure', '')}")
        print(f"     lieu        : {p.get('lieu') or '—'}")
        print(f"     lien        : {p.get('lien') or '—'}")
        print(f"     confiance   : {p.get('confiance_pct')} %")
        print(f"     résumé      : {p.get('resume')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
