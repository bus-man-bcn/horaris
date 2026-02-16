#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera data.json a partir d'un CSV de matriu origen-destí (fullmatrix_*).

IMPORTANT:
- Aquest script NO modifica cap fitxer de la web (index/app/styles).
- Només genera el data.json.

Per evitar "retalls":
- En una matriu, cada fila aporta hores per a parades; per tant:
  1) recollim totes les parades amb la seva hora (sortida i arribada)
  2) per cada parada ens quedem la més primerenca (robust)
  3) ordenem per hora per obtenir la seqüència completa
- Ajust de mitjanit: si hi ha 00:xx i també hores tardanes, 00:xx passa a +24h per ordenar bé
- Duplicació correcta: b2o / o2b es creen retallant el segment dins la seqüència completa.

Ús:
  python3 prepara_json_fixed.py -i horaris_manresa_barcelona_fullmatrix_tipusbus.csv -o data.json
"""

import argparse
import json
import re
from pathlib import Path
from collections import defaultdict

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
    return int(m.group(1))*60 + int(m.group(2))

def day_bucket(raw_day: str) -> str:
    s = str(raw_day).strip()
    for d in DAY_ORDER:
        if s.lower() == d.lower():
            return d
    low = s.lower()
    if "diumenge" in low:
        return DAY_ORDER[2]
    if "dissabte" in low or "festiu" in low:
        return DAY_ORDER[1]
    if "dilluns" in low or "feiner" in low:
        return DAY_ORDER[0]
    return s

def has_prefix(stops: list[str], prefixes: list[str]) -> bool:
    for st in stops:
        up = str(st).upper()
        for p in prefixes:
            if up.startswith(p):
                return True
    return False

def idx_first(stops: list[str], prefixes: list[str]) -> int | None:
    for i, s in enumerate(stops):
        up = str(s).upper()
        for p in prefixes:
            if up.startswith(p):
                return i
    return None

def idx_last(stops: list[str], prefixes: list[str]) -> int | None:
    for i in range(len(stops)-1, -1, -1):
        up = str(stops[i]).upper()
        for p in prefixes:
            if up.startswith(p):
                return i
    return None

def classify_bus_type(stops: list[str], raw_type: str | None) -> str:
    raw = (raw_type or "").strip().lower()
    bt = raw if raw in ("e22","e23") else "semidirecte"
    if bt == "e23":
        has_om = has_prefix(stops, ["OLESA","MONISTROL"])
        has_man = has_prefix(stops, ["MANRESA"])
        if has_man and not has_om:
            bt = "e22"
    return bt

def build_stop_sequence_from_matrix(g: pd.DataFrame) -> list[dict]:
    stop_to_min = {}
    stop_to_time = {}

    def add(stop, time_str):
        t = tmin(time_str)
        if t is None:
            return
        if stop not in stop_to_min or t < stop_to_min[stop]:
            stop_to_min[stop] = t
            stop_to_time[stop] = time_str

    for _, r in g.iterrows():
        ps, ts = r["Parada_sortida"], r["Hora_sortida"]
        pa, ta = r["Parada_arribada"], r["Hora_arribada"]

        if pd.notna(ps) and pd.notna(ts) and str(ts).strip() != "-":
            add(str(ps).strip(), norm_time(ts))
        if pd.notna(pa) and pd.notna(ta) and str(ta).strip() != "-":
            add(str(pa).strip(), norm_time(ta))

    if not stop_to_min:
        return []

    mins = list(stop_to_min.values())
    if mins and min(mins) < 180 and max(mins) > 1200:
        adj = {s: (m + 1440 if m < 180 else m) for s, m in stop_to_min.items()}
    else:
        adj = dict(stop_to_min)

    ordered = sorted(adj.items(), key=lambda x: x[1])
    return [{"stop": s, "time": stop_to_time[s]} for s,_ in ordered]

def slice_trip(stops: list[dict], i: int, j: int) -> dict:
    sub = stops[i:j+1]
    return {"start_time": sub[0]["time"], "end_time": sub[-1]["time"], "stops": sub}

def main():
    ap = argparse.ArgumentParser(description="Genera data.json (robust) des d'un CSV fullmatrix.")
    ap.add_argument("-i","--input", default="horaris_manresa_barcelona_fullmatrix_tipusbus.csv")
    ap.add_argument("-o","--output", default="data.json")
    args = ap.parse_args()

    csv_in = Path(args.input)
    out = Path(args.output)
    if not csv_in.exists():
        raise SystemExit(f"ERROR: No existeix {csv_in.resolve()}")

    df = pd.read_csv(csv_in)

    required = [
        "Tipus_bus","Tipus_dia","Direccio",
        "Parada_sortida","Hora_sortida","Parada_arribada","Hora_arribada",
        "Id_viatge_dia"
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise SystemExit(f"ERROR: Falta(n) columna(es): {missing}")

    group_cols = ["Tipus_dia","Direccio","Tipus_bus","Id_viatge_dia"]

    containers = {
        sid: {d: {"e22":[], "e23":[], "semidirecte":[]} for d in DAY_ORDER}
        for sid,_,_ in SECTIONS
    }

    def add(sec_id, day, bt, trip_id_out, sub):
        containers[sec_id][day][bt].append({
            "trip_id": trip_id_out,
            "start_time": sub["start_time"],
            "end_time": sub["end_time"],
            "stops": sub["stops"],
        })

    for (day_raw, direction, bus_raw, trip_id), g in df.groupby(group_cols, dropna=False):
        day = day_bucket(day_raw)
        if day not in containers["m2b"]:
            continue

        stop_list = build_stop_sequence_from_matrix(g)
        if len(stop_list) < 2:
            continue

        stop_names = [x["stop"] for x in stop_list]
        raw_type = None if pd.isna(bus_raw) else str(bus_raw)
        bt = classify_bus_type(stop_names, raw_type)

        trip_id_out = int(trip_id) if str(trip_id).isdigit() else str(trip_id)

        if direction == "Manresa - Barcelona":
            bt_m2b = bt if bt in ("e22","semidirecte") else "semidirecte"
            add("m2b", day, bt_m2b, trip_id_out, slice_trip(stop_list, 0, len(stop_list)-1))

            si = idx_first(stop_names, ["OLESA","MONISTROL"])
            ei = idx_last(stop_names, ["BCN"])
            if si is not None and ei is not None and si < ei:
                bt_o2b = bt if bt in ("e23","semidirecte") else "semidirecte"
                add("o2b", day, bt_o2b, trip_id_out, slice_trip(stop_list, si, ei))

        elif direction == "Barcelona - Manresa":
            bt_b2m = bt if bt in ("e22","semidirecte") else "semidirecte"
            add("b2m", day, bt_b2m, trip_id_out, slice_trip(stop_list, 0, len(stop_list)-1))

            si = idx_first(stop_names, ["BCN"])
            ei = idx_last(stop_names, ["OLESA","MONISTROL"])
            if si is not None and ei is not None and si < ei:
                bt_b2o = bt if bt in ("e23","semidirecte") else "semidirecte"
                add("b2o", day, bt_b2o, trip_id_out, slice_trip(stop_list, si, ei))

    for sid in containers:
        for d in containers[sid]:
            for bt in containers[sid][d]:
                containers[sid][d][bt].sort(key=lambda x: (tmin(x["start_time"]) or 10**9, str(x["trip_id"])))

    out_data = {
        "sections": [
            {
                "id": sid,
                "title": title,
                "busTypeOrder": order,
                "days": [{"name": d, "buses": containers[sid][d]} for d in DAY_ORDER],
            }
            for sid,title,order in SECTIONS
        ]
    }

    out.write_text(json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK -> {out.resolve()}")

if __name__ == "__main__":
    main()
