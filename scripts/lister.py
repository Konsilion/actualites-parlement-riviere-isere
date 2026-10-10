#!/usr/bin/env python3
"""Affiche les actualités validées (data/actualites.csv) — contrôle rapide."""
import csv
import sys
from pathlib import Path

CSV = Path(__file__).resolve().parent.parent / "data" / "actualites.csv"

TYPE_LABELS = {
    "evenement_a_venir": "Événement à venir",
    "ressource_publiee": "Ressource publiée",
    "evenement_passe": "Événement passé",
    "information_parlement": "Information du parlement",
}


def main():
    if not CSV.exists():
        print("CSV absent :", CSV)
        return 1
    with open(CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        print("Aucune actualité validée (CSV vide).")
        return 0
    print(f"{len(rows)} actualité(s) validée(s) :")
    for r in rows:
        typ = TYPE_LABELS.get(r["type"], r["type"])
        print(f"\n  [{r['id']}] {r['titre']}")
        print(f"      ajouté le  : {r['date_ajout']} · type : {typ}")
        dates = r["date_debut"] or "—"
        if r["date_fin"]:
            dates += f" → {r['date_fin']}"
        print(f"      dates      : {dates} · lieu : {r['lieu'] or '—'}")
        print(f"      lien       : {r['lien'] or '—'}")
        print(f"      résumé     : {r['description']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
