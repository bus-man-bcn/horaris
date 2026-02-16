// Accessible UI: 2 blocs de botons + toggle per botó (aria-expanded) sense <details>
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}

function cssSafe(s){
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function speakBusType(bt){
  if (bt === "e22") return "E 22";
  if (bt === "e23") return "E 23";
  return "Semidirecte";
}

function routeSentence(stops){
  const parts = stops.map(s => `${s.time} ${s.stop}`);
  return "Recorregut: " + parts.join("; ") + ".";
}

function tripLabel(tr, bt){
  return `Servei ${speakBusType(bt)}. Sortida ${tr.start_time}. Arribada ${tr.end_time}.`;
}

function makeTrip(tr, bt, uid){
  const wrap = el("div", { class: "trip" });
  const panelId = `trip_${uid}`;

  const btn = el("button", {
    class: "trip-toggle",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": panelId,
    "aria-label": tripLabel(tr, bt)
  });

  btn.appendChild(el("span", { class:"meta", text: tripLabel(tr, bt) }));
  btn.appendChild(el("span", { class:"hint", text: "Toca per mostrar o amagar el recorregut." }));

  const content = el("div", { class:"trip-content", id: panelId, hidden: "" });
  content.appendChild(el("p", { text: routeSentence(tr.stops) }));

  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (expanded) {
      content.setAttribute("hidden", "");
    } else {
      content.removeAttribute("hidden");
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(content);
  return wrap;
}

function showPanel(panelKey){
  const panels = document.getElementById("panels");
  panels.querySelectorAll(".panel").forEach(p => p.setAttribute("aria-hidden","true"));

  const target = document.getElementById(`panel_${cssSafe(panelKey)}`);
  if (target) {
    target.setAttribute("aria-hidden","false");
    const h = target.querySelector("h3");
    if (h) {
      h.setAttribute("tabindex","-1");
      h.focus();
    }
  }

  // update buttons aria-pressed
  document.querySelectorAll(".picker button").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.target === panelKey ? "true" : "false");
  });
}

function buildUI(data){
  const loading = document.getElementById("loading");
  const panelsRoot = document.getElementById("panels");
  const pickerMB = document.getElementById("picker-mb");
  const pickerMO = document.getElementById("picker-mo");

  loading.textContent = "";
  const sections = data.sections || [];
  if (!sections.length){
    loading.textContent = "No hi ha dades.";
    return;
  }

  const entries = [];
  for (const sec of sections){
    for (const day of (sec.days || [])){
      entries.push({ key: `${sec.id}__${day.name}`, sec, day });
    }
  }

  // Create panels first
  let tripUid = 0;
  for (const e of entries){
    const panelKey = e.key;
    const panel = el("div", { class:"panel", id:`panel_${cssSafe(panelKey)}`, "aria-hidden":"true" });

    panel.appendChild(el("h3", { text: `${e.sec.title} — ${e.day.name}` }));

    const order = e.sec.busTypeOrder || ["e22","e23","semidirecte"];
    for (const bt of order){
      const trips = (e.day.buses && e.day.buses[bt]) ? e.day.buses[bt] : [];
      if (!trips.length) continue;

      const grp = el("div", { class:"bus-group" });
      grp.appendChild(el("h4", { text: speakBusType(bt) }));

      for (const tr of trips){
        tripUid += 1;
        grp.appendChild(makeTrip(tr, bt, tripUid));
      }
      panel.appendChild(grp);
    }

    panelsRoot.appendChild(panel);
  }

  // Create buttons split into 2 blocks
  let firstPanelKey = null;
  for (const e of entries){
    if (!firstPanelKey) firstPanelKey = e.key;

    const btn = el("button", {
      type:"button",
      "aria-pressed":"false",
      "data-target": e.key
    }, [document.createTextNode(`${e.sec.title} · ${e.day.name}`)]);

    btn.addEventListener("click", () => showPanel(e.key));

    const isMB = (e.sec.id === "m2b" || e.sec.id === "b2m");
    (isMB ? pickerMB : pickerMO).appendChild(btn);
  }

  if (firstPanelKey) showPanel(firstPanelKey);
}

fetch("data.json")
  .then(r => r.json())
  .then(buildUI)
  .catch(() => {
    const loading = document.getElementById("loading");
    if (loading) loading.textContent = "Error carregant dades.";
  });
