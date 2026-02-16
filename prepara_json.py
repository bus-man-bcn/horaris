#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
from pathlib import Path
import argparse
import pandas as pd

DAY_ORDER = [
    "Dilluns a divendres feiners, excepte agost",
    "Dissabtes i Festius",
    "Diumenges, excepte festiu",
]

SECTIONS = [
    ("m2b", "Manresa → Barcelona", ["e22", "semidirecte"]),
    ("b2m", "Barcelona → Manresa", ["e22", "semidirecte"]),
    ("o2b", "Olesa o Monistrol → Barcelona", ["e23", "semidirecte"]),
    ("b2o", "Barcelona → Olesa o Monistrol", ["e23", "semidirecte"]),
]


def norm_time(x) -> str:
    s = str(x).strip().replace(".", ":")
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return s
    return f"{int(m.group(1)):02d}:{int(m.group(2)):02d}"


def tmin(x) -> int | None:
    m = re.match(r"^(\d{2}):(\d{2})$", str(x))
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def has_prefix(stops: list[str], prefixes: list[str]) -> bool:
    for st in stops:
        up = str(st).upper()
        for p in prefixes:
            if up.startswith(p):
                return True
    return False


def day_bucket(raw_day: str) -> str:
    s = str(raw_day).lower()
    if "dilluns" in s or "feiner" in s:
        return DAY_ORDER[0]
    if "dissabte" in s or "festiu" in s:
        return DAY_ORDER[1]
    if "diumenge" in s:
        return DAY_ORDER[2]
    return str(raw_day).strip()


def classify_bus_type(stops: list[str], raw_type: str | None) -> str:
    """
    Regles (corregides perquè NO deixi semidirecte buit):
    - Si Tipus_bus és 'e22' o 'e23' -> fem servir això (amb el fix de sota).
    - Si Tipus_bus és buit/NaN/altres -> 'semidirecte'.

    Fix (Punt 2):
    - Si Tipus_bus == 'e23' però passa per MANRESA i NO passa per OLESA/MONISTROL -> 'e22'
    """
    raw = (raw_type or "").strip().lower()
    bt = raw if raw in ("e22", "e23") else "semidirecte"

    if bt == "e23":
        has_olesa = has_prefix(stops, ["OLESA"])
        has_mon = has_prefix(stops, ["MONISTROL"])
        has_man = has_prefix(stops, ["MANRESA"])
        if has_man and not (has_olesa or has_mon):
            bt = "e22"

    return bt


def guess_section(first_stop: str, stops: list[str]) -> str | None:
    first = str(first_stop).upper()
    has_bcn = has_prefix(stops, ["BCN"])
    has_man = has_prefix(stops, ["MANRESA"])
    has_om = has_prefix(stops, ["OLESA", "MONISTROL"])

    if first.startswith("MANRESA") and has_bcn:
        return "m2b"
    if first.startswith("BCN") and has_man:
        return "b2m"
    if (first.startswith("OLESA") or first.startswith("MONISTROL")) and has_bcn:
        return "o2b"
    if first.startswith("BCN") and has_om:
        return "b2o"
    return None


def build_data(df: pd.DataFrame) -> dict:
    required_cols = {
        "Tipus_dia",
        "Direccio",
        "Tipus_bus",
        "Id_viatge_dia",
        "Parada_sortida",
        "Hora_sortida",
        "Parada_arribada",
        "Hora_arribada",
    }
    missing = required_cols - set(df.columns)
    if missing:
        raise SystemExit(f"ERROR: Falta(n) columna(es): {sorted(missing)}")

    group_cols = ["Tipus_dia", "Direccio", "Tipus_bus", "Id_viatge_dia"]
    raw_trips = []

    for (day, _direction, bus_raw, trip_id), g in df.groupby(group_cols, dropna=False):
        stops = {}

        for _, r in g.iterrows():
            ps, ts = r.get("Parada_sortida"), r.get("Hora_sortida")
            if pd.notna(ps) and pd.notna(ts) and str(ts).strip() != "-":
                stops[str(ps)] = norm_time(ts)

            pa, ta = r.get("Parada_arribada"), r.get("Hora_arribada")
            if pd.notna(pa) and pd.notna(ta) and str(ta).strip() != "-":
                pa = str(pa)
                stops.setdefault(pa, norm_time(ta))

        items = [(s, t) for s, t in stops.items() if tmin(norm_time(t)) is not None]
        if not items:
            continue

        items.sort(key=lambda x: tmin(norm_time(x[1])) or 10**9)
        stop_list = [{"stop": s, "time": norm_time(t)} for s, t in items]

        all_stops = [x["stop"] for x in stop_list]
        first_stop = stop_list[0]["stop"]

        raw_type = None if pd.isna(bus_raw) else str(bus_raw)
        bt = classify_bus_type(all_stops, raw_type)

        sec = guess_section(first_stop, all_stops)
        if not sec:
            continue

        trip_id_out = int(trip_id) if str(trip_id).isdigit() else str(trip_id)

        raw_trips.append(
            {
                "section": sec,
                "day": str(day),
                "busType": bt,
                "trip_id": trip_id_out,
                "start_time": stop_list[0]["time"],
                "end_time": stop_list[-1]["time"],
                "stops": stop_list,
            }
        )

    sections = {
        sid: {d: {"e22": [], "e23": [], "semidirecte": []} for d in DAY_ORDER}
        for sid, _, _ in SECTIONS
    }

    for tr in raw_trips:
        d = day_bucket(tr["day"])
        if d not in sections[tr["section"]]:
            sections[tr["section"]][d] = {"e22": [], "e23": [], "semidirecte": []}
        sections[tr["section"]][d][tr["busType"]].append(tr)

    for sid in sections:
        for d in sections[sid]:
            for bt in sections[sid][d]:
                sections[sid][d][bt].sort(
                    key=lambda x: (tmin(x["start_time"]) or 10**9, str(x["trip_id"]))
                )

    return {
        "sections": [
            {
                "id": sid,
                "title": title,
                "busTypeOrder": order,
                "days": [
                    {"name": d, "buses": sections[sid][d]}
                    for d in DAY_ORDER
                    if d in sections[sid]
                ],
            }
            for sid, title, order in SECTIONS
        ]
    }


def main():
    ap = argparse.ArgumentParser(description="Genera data.json a partir de horaris_manresa_barcelona_fullmatrix_tipusbus.csv")
    ap.add_argument("-i", "--input", default="horaris_manresa_barcelona_fullmatrix_tipusbus.csv", help="CSV d'entrada")
    ap.add_argument("-o", "--output", default="data.json", help="JSON de sortida")
    args = ap.parse_args()

    csv_in = Path(args.input)
    out = Path(args.output)

    if not csv_in.exists():
        raise SystemExit(f"ERROR: No existeix {csv_in.resolve()}")

    df = pd.read_csv(csv_in)
    out_data = build_data(df)

    out.write_text(json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK -> {out.resolve()}")


if __name__ == "__main__":
    main()
