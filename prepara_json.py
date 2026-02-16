import pandas as pd
import json, re
from pathlib import Path

# -------- Config --------
CSV_IN = Path("horaris.csv")
OUT = Path("data.json")

DAY_ORDER = [
  "Dilluns a divendres feiners, excepte agost",
  "Dissabtes i Festius",
  "Diumenges, excepte festiu",
]

SECTIONS = [
  ("m2b", "Manresa → Barcelona", ["e22","semidirecte"]),
  ("b2m", "Barcelona → Manresa", ["e22","semidirecte"]),
  ("o2b", "Olesa o Monistrol → Barcelona", ["e23","semidirecte"]),
  ("b2o", "Barcelona → Olesa o Monistrol", ["e23","semidirecte"]),
]

# -------- Helpers --------
def norm_time(x):
  s = str(x).strip().replace(".", ":")
  m = re.match(r"^(\d{1,2}):(\d{2})$", s)
  if not m: return s
  return f"{int(m.group(1)):02d}:{int(m.group(2)):02d}"

def tmin(x):
  m = re.match(r"^(\d{2}):(\d{2})$", str(x))
  if not m: return None
  return int(m.group(1))*60 + int(m.group(2))

def has_prefix(stops, prefixes):
  for st in stops:
    up = st.upper()
    for p in prefixes:
      if up.startswith(p):
        return True
  return False

def classify(stops, raw_type):
  """
  Regles:
  - Si passa per Olesa o Monistrol -> e23
  - Si passa per Manresa (i no passa per Olesa/Monistrol) -> e22
  - Si no encaixa -> Semidirecte
  - Si raw_type diu e23 però el recorregut NO passa per Olesa/Monistrol i sí per Manresa -> e22
  """
  has_olesa = has_prefix(stops, ["OLESA"])
  has_mon   = has_prefix(stops, ["MONISTROL"])
  has_man   = has_prefix(stops, ["MANRESA"])

  if has_olesa or has_mon:
    inferred = "e23"
  elif has_man:
    inferred = "e22"
  else:
    inferred = "semidirecte"

  rt = (raw_type or "").strip().lower()
  if rt == "e23" and has_man and not (has_olesa or has_mon):
    inferred = "e22"

  if inferred not in ("e22","e23"):
    inferred = "semidirecte"
  return inferred

def guess_section(first_stop, stops):
  first = first_stop.upper()
  has_bcn = has_prefix(stops, ["BCN"])
  has_man = has_prefix(stops, ["MANRESA"])
  has_om  = has_prefix(stops, ["OLESA","MONISTROL"])

  if first.startswith("MANRESA") and has_bcn: return "m2b"
  if first.startswith("BCN") and has_man and not has_om: return "b2m"
  if (first.startswith("OLESA") or first.startswith("MONISTROL")) and has_bcn: return "o2b"
  if first.startswith("BCN") and has_om: return "b2o"
  # Fallbacks
  if first.startswith("BCN") and has_bcn and has_man: return "b2m"
  if first.startswith("MANRESA") and has_bcn and has_om: return "m2b"
  return None

def normalize_day(x):
  s = str(x).strip().lower()
  # IMPORTANT: diumenge primer, perquè hi ha textos amb "festiu"
  if "diumenge" in s:
    return DAY_ORDER[2]
  if "dilluns" in s or "feiner" in s:
    return DAY_ORDER[0]
  if "dissabte" in s or "festiu" in s:
    return DAY_ORDER[1]
  return str(x).strip()

def build_stop_sequence(g):
  """
  Reconstrueix l'ordre de parades a partir de la matriu origen-destí.
  Evita ordenar per hora (problemes a la nit/00:xx).
  """
  edges = {}  # ps -> (pa, dep, arr)
  starts = set()
  ends = set()

  for _, r in g.iterrows():
    ps = r.get("Parada_sortida")
    pa = r.get("Parada_arribada")
    ts = r.get("Hora_sortida")
    ta = r.get("Hora_arribada")

    if pd.isna(ps) or pd.isna(pa):
      continue

    ps = str(ps).strip()
    pa = str(pa).strip()

    dep = None if pd.isna(ts) or str(ts).strip() == "-" else norm_time(ts)
    arr = None if pd.isna(ta) or str(ta).strip() == "-" else norm_time(ta)

    # Guardem el primer edge per cada sortida (la ruta és lineal)
    if ps not in edges:
      edges[ps] = (pa, dep, arr)

    starts.add(ps)
    ends.add(pa)

  # Troba inici: parada que surt però no és arribada
  candidates = list(starts - ends)
  start = candidates[0] if candidates else None
  if not start and edges:
    start = next(iter(edges.keys()))
  if not start:
    return []

  seq = []
  current = start

  # Inicial: hora de sortida si existeix
  pa, dep, arr = edges.get(current, (None, None, None))
  seq.append({"stop": current, "time": dep or (arr or "")})

  # Recórrer fins al final
  guard = 0
  while current in edges and guard < 200:
    guard += 1
    nxt, dep, arr = edges[current]

    # Si tenim hora de sortida per la parada actual, la prioritzem
    if dep:
      seq[-1]["time"] = dep

    # Afegeix següent parada amb hora d'arribada (o buit si falta)
    seq.append({"stop": nxt, "time": arr or ""})
    current = nxt

  # Neteja: omple hores buides si hi ha alguna (últim recurs: manté "")
  for s in seq:
    s["time"] = norm_time(s["time"]) if s["time"] else s["time"]

  # Si la seqüència no té hores vàlides, retorna buit
  if not any(tmin(s["time"]) is not None for s in seq):
    return []

  # Start/end times: primer/últim temps "real"
  times = [s["time"] for s in seq if tmin(s["time"]) is not None]
  start_time = times[0]
  end_time = times[-1]

  return seq, start_time, end_time

# -------- Main --------
df = pd.read_csv(CSV_IN)

group_cols = ["Tipus_dia","Direccio","Tipus_bus","Id_viatge_dia"]
raw_trips = []

for (day_raw, direction, bus_raw, trip_id), g in df.groupby(group_cols, dropna=False):
  built = build_stop_sequence(g)
  if not built:
    continue
  stop_list, start_time, end_time = built

  all_stops = [x["stop"] for x in stop_list]
  first_stop = all_stops[0]

  bt = classify(all_stops, None if pd.isna(bus_raw) else str(bus_raw))
  sec = guess_section(first_stop, all_stops)
  if not sec:
    continue

  day = normalize_day(day_raw)

  raw_trips.append({
    "section": sec,
    "day": day,
    "busType": bt,
    "trip_id": int(trip_id) if str(trip_id).isdigit() else str(trip_id),
    "start_time": start_time,
    "end_time": end_time,
    "stops": stop_list
  })

# Estructura de sortida (sempre amb 3 dies)
sections = {sid: {d: {"e22":[], "e23":[], "semidirecte":[]} for d in DAY_ORDER}
            for sid,_,_ in SECTIONS}

for tr in raw_trips:
  sections[tr["section"]][tr["day"]][tr["busType"]].append(tr)

for sid in sections:
  for d in DAY_ORDER:
    for bt in sections[sid][d]:
      sections[sid][d][bt].sort(key=lambda x: (tmin(x["start_time"]) or 10**9, str(x["trip_id"])))


OUT_DATA = {
  "sections": [
    {
      "id": sid,
      "title": title,
      "busTypeOrder": order,
      "days": [{"name": d, "buses": sections[sid][d]} for d in DAY_ORDER],
    }
    for sid, title, order in SECTIONS
  ]
}

OUT.write_text(json.dumps(OUT_DATA, ensure_ascii=False, indent=2), encoding="utf-8")
print("OK ->", OUT)
