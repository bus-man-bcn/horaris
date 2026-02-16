// Accessible rendering for TalkBack/VoiceOver (12 botons + lectura fluida)
// Versió: sense <details>/<summary> per evitar "està replegat" a TalkBack.

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

function speakBusType(bt){
  if (bt === "e22") return "E 22";
  if (bt === "e23") return "E 23";
  return "Semidirecte";
}

function routeSentence(stops){
  // Una sola frase perquè el lector ho llegeixi seguit
  const parts = stops.map(s => `${s.time} ${s.stop}`);
  return "Recorregut: " + parts.join("; ") + ".";
}

function tripHeading(tr, bt){
  return `Servei ${speakBusType(bt)}. Sortida ${tr.start_time}. Arribada ${tr.end_time}.`;
}

function makeTripCard(tr, bt){
  const card = el("div", { class: "trip" });

  // Capçalera (una sola frase)
  card.appendChild(el("h5", { class: "trip-title" }, [
    document.createTextNode(tripHeading(tr, bt))
  ]));

  // Frase “tot seguit”
  card.appendChild(el("p", { class: "route-sentence" }, [
    document.createTextNode(routeSentence(tr.stops))
  ]));

  // Llista (una a una)
  const ol = el("ol", { class: "stops" });
  for (const st of tr.stops) {
    const li = el("li", {});
    li.appendChild(el("time", { datetime: st.time, text: st.time }));
    li.appendChild(document.createTextNode(" — " + st.stop));
    ol.appendChild(li);
  }
  card.appendChild(ol);

  return card;
}

function cssSafe(s){
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function sectionLine(secId){
  // 2 grups al selector
  if (secId === "m2b" || secId === "b2m") return "mb";
  return "om"; // o2b / b2o
}

function buildUI(data){
  const pickerMB = document.getElementById("picker-mb");
  const pickerOM = document.getElementById("picker-om");
  const panels = document.getElementById("panels");
  const loading = document.getElementById("loading");
  loading.textContent = "";

  const sections = data.sections || [];
  if (!sections.length){
    loading.textContent = "No hi ha dades.";
    return;
  }

  // Build 12 entries: (4 seccions) x (3 dies)
  const entries = [];
  for (const sec of sections){
    for (const day of (sec.days || [])){
      entries.push({
        key: `${sec.id}__${day.name}`,
        sec,
        day
      });
    }
  }

  // Panels
  for (const e of entries){
    const panelId = `panel_${cssSafe(e.key)}`;
    const panel = el("div", { class: "panel", id: panelId, "aria-hidden": "true" });

    const headingId = `ph_${cssSafe(e.key)}`;
    const h = el("h3", { id: headingId }, [
      document.createTextNode(`${e.sec.title} — ${e.day.name}`)
    ]);
    panel.appendChild(h);

    // Bus groups ordered (per data.json)
    const order = e.sec.busTypeOrder || ["e22","e23","semidirecte"];
    for (const bt of order){
      const trips = (e.day.buses && e.day.buses[bt]) ? e.day.buses[bt] : [];
      if (!trips.length) continue;

      const group = el("div", { class:"bus-group" });
      group.appendChild(el("h4", {}, [document.createTextNode(speakBusType(bt))]));

      for (const tr of trips){
        group.appendChild(makeTripCard(tr, bt));
      }
      panel.appendChild(group);
    }

    // Si no hi ha res, un missatge curt
    if (!panel.querySelector(".bus-group")){
      panel.appendChild(el("p", { class:"muted" }, [document.createTextNode("No hi ha horaris per aquesta selecció.")]));
    }

    panels.appendChild(panel);
  }

  // Buttons (repartits en 2 pickers)
  let firstKey = null;

  function addButton(e){
    if (!firstKey) firstKey = e.key;

    const btn = el("button", {
      type: "button",
      "data-target": e.key,
      "aria-pressed": "false"
    }, []);

    // Text visible (evitem tags dins frase)
    btn.appendChild(el("span", { text: e.sec.title }));
    btn.appendChild(el("span", { class:"visually-hidden", text:" — " }));
    btn.appendChild(el("span", { text: " " + e.day.name }));

    btn.addEventListener("click", () => select(e.key));
    const line = sectionLine(e.sec.id);
    (line === "mb" ? pickerMB : pickerOM).appendChild(btn);
  }

  for (const e of entries) addButton(e);

  function select(key){
    // Update buttons (tots dos pickers)
    for (const b of document.querySelectorAll("#picker-mb button, #picker-om button")){
      const active = b.getAttribute("data-target") === key;
      b.setAttribute("aria-pressed", active ? "true" : "false");
    }
    // Update panels
    for (const p of panels.querySelectorAll(".panel")){
      const isTarget = p.id === `panel_${cssSafe(key)}`;
      p.setAttribute("aria-hidden", isTarget ? "false" : "true");
    }
    // Focus al títol del panel
    const heading = document.getElementById(`ph_${cssSafe(key)}`);
    if (heading){
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex","-1");
      heading.focus();
    }
  }

  select(firstKey);
}

fetch("data.json")
  .then(r => r.json())
  .then(buildUI)
  .catch(() => {
    const loading = document.getElementById("loading");
    if (loading) loading.textContent = "Error carregant dades.";
  });
