#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import re
from pathlib import Path

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


def has_any_stop(stops: list[str], prefixes: list[str]) -> bool:
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
    for i in range(len(stops) - 1, -1, -1):
        up = str(stops[i]).upper()
        for p in prefixes:
            if up.startswith(p):
                return i
    return None


def day_bucket(raw_day: str) -> str:
    # Aquí ja et ve normalitzat al CSV, però ho deixem robust
    s = str(raw_day).strip()
    for d in DAY_ORDER:
        if s.lower() == d.lower():
            return d
    low = s.lower()
    if "dilluns" in low or "feiner" in low:
        return DAY_ORDER[0]
    if "dissabte" in low or "festiu" in low:
        return DAY_ORDER[1]
    if "diumenge" in low:
        return DAY_ORDER[2]
    return s


def classify_bus_type(stops: list[str], raw_type: str | None) -> str:
    """
    - Respecta Tipus_bus si és e22/e23
    - Altrament -> semidirecte
    Fix Punt 2:
    - e23 + passa per Manresa però NO passa per Olesa/Monistrol -> e22
    """
    raw = (raw_type or "").strip().lower()
    bt = raw if raw in ("e22", "e23") else "semidirecte"

    if bt == "e23":
        has_om = has_any_stop(stops, ["OLESA", "MONISTROL"])
        has_man = has_any_stop(stops, ["MANRESA"])
        if has_man and not has_om:
            bt = "e22"

    return bt


def slice_trip(stops_times: list[dict], start_i: int, end_i: int) -> dict:
    sub = stops_times[start_i : end_i + 1]
    return {
        "start_time": sub[0]["time"],
        "end_time": sub[-1]["time"],
        "stops": sub,
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

    required = [
        "Tipus_bus",
        "Tipus_dia",
        "Direccio",
        "Parada_sortida",
        "Hora_sortida",
        "Parada_arribada",
        "Hora_arribada",
        "Id_viatge_dia",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise SystemExit(f"ERROR: Falta(n) columna(es): {missing}")

    group_cols = ["Tipus_dia", "Direccio", "Tipus_bus", "Id_viatge_dia"]

    # Contenidors finals
    containers = {
        sid: {d: {"e22": [], "e23": [], "semidirecte": []} for d in DAY_ORDER}
        for sid, _, _ in SECTIONS
    }

    def add(sec_id: str, day: str, bt: str, trip_id_out, sub: dict):
        containers[sec_id][day][bt].append(
            {
                "trip_id": trip_id_out,
                "start_time": sub["start_time"],
                "end_time": sub["end_time"],
                "stops": sub["stops"],
            }
        )

    # 1) Construïm viatges ordenats per hora
    for (day_raw, direction, bus_raw, trip_id), g in df.groupby(group_cols, dropna=False):
        day = day_bucket(str(day_raw))
        if day not in containers["m2b"]:
            continue

        # map parada->hora (prou per aquesta matriu)
        stops = {}
        for _, r in g.iterrows():
            ps, ts = r["Parada_sortida"], r["Hora_sortida"]
            if pd.notna(ps) and pd.notna(ts) and str(ts).strip() != "-":
                stops[str(ps)] = norm_time(ts)

            pa, ta = r["Parada_arribada"], r["Hora_arribada"]
            if pd.notna(pa) and pd.notna(ta) and str(ta).strip() != "-":
                stops.setdefault(str(pa), norm_time(ta))

        items = [(s, t) for s, t in stops.items() if tmin(norm_time(t)) is not None]
        if not items:
            continue

        items.sort(key=lambda x: tmin(norm_time(x[1])) or 10**9)
        stop_list = [{"stop": s, "time": norm_time(t)} for s, t in items]
        stop_names = [x["stop"] for x in stop_list]

        raw_type = None if pd.isna(bus_raw) else str(bus_raw)
        bt = classify_bus_type(stop_names, raw_type)

        trip_id_out = int(trip_id) if str(trip_id).isdigit() else str(trip_id)

        # 2) Assignació a seccions + duplicació (retallant)
        if direction == "Manresa - Barcelona":
            # Manresa → Barcelona (complet)
            bt_m2b = bt if bt in ("e22", "semidirecte") else "semidirecte"
            add("m2b", day, bt_m2b, trip_id_out, slice_trip(stop_list, 0, len(stop_list) - 1))

            # Olesa/Monistrol → Barcelona (retall) si el recorregut ho permet
            if has_any_stop(stop_names, ["OLESA", "MONISTROL"]) and has_any_stop(stop_names, ["BCN"]):
                si = idx_first(stop_names, ["OLESA", "MONISTROL"])
                ei = idx_last(stop_names, ["BCN"])
                if si is not None and ei is not None and si < ei:
                    bt_o2b = bt if bt in ("e23", "semidirecte") else "semidirecte"
                    add("o2b", day, bt_o2b, trip_id_out, slice_trip(stop_list, si, ei))

        elif direction == "Barcelona - Manresa":
            # Barcelona → Manresa (complet)
            bt_b2m = bt if bt in ("e22", "semidirecte") else "semidirecte"
            add("b2m", day, bt_b2m, trip_id_out, slice_trip(stop_list, 0, len(stop_list) - 1))

            # Barcelona → Olesa/Monistrol (retall) si el recorregut ho permet
            if has_any_stop(stop_names, ["BCN"]) and has_any_stop(stop_names, ["OLESA", "MONISTROL"]):
                si = idx_first(stop_names, ["BCN"])
                ei = idx_last(stop_names, ["OLESA", "MONISTROL"])
                if si is not None and ei is not None and si < ei:
                    bt_b2o = bt if bt in ("e23", "semidirecte") else "semidirecte"
                    add("b2o", day, bt_b2o, trip_id_out, slice_trip(stop_list, si, ei))

    # 3) Ordenar per hora de sortida
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
            for sid, title, order in SECTIONS
        ]
    }

    out.write_text(json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK -> {out.resolve()}")


if __name__ == "__main__":
    main()
