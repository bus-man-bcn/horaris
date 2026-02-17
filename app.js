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

function normBusLabel(bt){
  if (bt === "e22") return "E 22";
  if (bt === "e23") return "E 23";
  return "Semidirecte";
}

// ordre demanat
function tripHeader(tr, bt){
  return `Sortida ${tr.start_time}. Arribada ${tr.end_time}. Servei ${normBusLabel(bt)}.`;
}

// lectura seguida (una sola frase)
function routeSentence(tr){
  const parts = tr.stops.map(s => `${s.time} ${s.stop}`);
  return `Recorregut: ${parts.join("; ")}.`;
}

function safeId(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function selectPanel(panelByKey, panelsRoot, targetPicker, key, pressedButton, doScroll){
  if (targetPicker){
    for (const btn of targetPicker.querySelectorAll("button")) btn.setAttribute("aria-pressed","false");
  }
  if (pressedButton) pressedButton.setAttribute("aria-pressed","true");

  for (const p of panelsRoot.querySelectorAll(".panel")) p.setAttribute("aria-hidden","true");
  const panel = panelByKey.get(key);
  if (panel) panel.setAttribute("aria-hidden","false");

  // Evitem salts en carregar: només scroll quan l’usuari fa clic
  if (doScroll){
    const h = document.getElementById("h-result");
    if (h) h.scrollIntoView({behavior:"smooth", block:"start"});
  }
}

function buildUI(data){
  const loading = document.getElementById("loading");
  const panels  = document.getElementById("panels");
  const pickerMB = document.getElementById("picker-mb");
  const pickerMO = document.getElementById("picker-mo");

  if (!data || !Array.isArray(data.sections)){
    if (loading) loading.textContent = "Error: data.json no té el format esperat (falta sections).";
    return;
  }

  panels.innerHTML = "";
  pickerMB.innerHTML = "";
  pickerMO.innerHTML = "";
  if (loading) loading.textContent = "";

  const panelByKey = new Map();

  function makePanel(section, day){
    const key = `${section.id}__${day.name}`;
    const panel = el("div", {class:"panel", id:`panel-${safeId(key)}`, "aria-hidden":"true"});

    panel.appendChild(el("h3", {text: `${section.title} — ${day.name}`}));

    // 2 botons dins la secció: Directes / Semidirectes
    const btDirect = (section.busTypeOrder && section.busTypeOrder[0]) ? section.busTypeOrder[0] : "e22";
    const btSemi = "semidirecte";

    const tabs = el("div", {class:"segment-tabs", role:"group", "aria-label":"Tipus de servei"});
    const btnA = el("button", {type:"button", "aria-pressed":"true"}, [
      document.createTextNode(`Directes (${normBusLabel(btDirect)})`)
    ]);
    const btnB = el("button", {type:"button", "aria-pressed":"false"}, [
      document.createTextNode("Semidirectes")
    ]);
    tabs.appendChild(btnA);
    tabs.appendChild(btnB);
    panel.appendChild(tabs);

    const listBox = el("div", {class:"bus-list"});
    panel.appendChild(listBox);

    function render(bt){
      listBox.innerHTML = "";
      const trips = (day.buses && day.buses[bt]) ? day.buses[bt] : [];
      if (!trips.length){
        listBox.appendChild(el("p", {class:"muted", text:"No hi ha horaris en aquesta secció."}));
        return;
      }

      trips.forEach((tr, i) => {
        const tripWrap = el("div", {class:"trip"});

        const tripId = `trip_${safeId(section.id)}_${safeId(day.name)}_${safeId(bt)}_${i}`;

        const btn = el("button", {
          class: "trip-toggle",
          type: "button",
          "aria-expanded": "false",
          "aria-controls": tripId,
          text: tripHeader(tr, bt)
        });

        const panel = el("div", {id: tripId, class: "trip-content", hidden: ""});
        panel.appendChild(el("p", {text: routeSentence(tr)}));

        tripWrap.appendChild(btn);
        tripWrap.appendChild(panel);
        listBox.appendChild(tripWrap);
      });
    }

    function setPressed(aPressed){
      btnA.setAttribute("aria-pressed", aPressed ? "true" : "false");
      btnB.setAttribute("aria-pressed", aPressed ? "false" : "true");
    }

    btnA.addEventListener("click", () => { setPressed(true); render(btDirect); });
    btnB.addEventListener("click", () => { setPressed(false); render(btSemi); });

    // per defecte: directes
    render(btDirect);

    panelByKey.set(key, panel);
    panels.appendChild(panel);
    return key;
  }

  function addPickerButton(targetPicker, label, key){
    const b = el("button", {type:"button", "aria-pressed":"false", "data-key": key}, [
      // Evitem el símbol "·" (TalkBack diu “punto volado”): fem servir “—”
      document.createTextNode(label)
    ]);
    b.addEventListener("click", () => selectPanel(panelByKey, panels, targetPicker, key, b, true));
    targetPicker.appendChild(b);
    return b;
  }

  // panells + botons (12 en total)
  for (const section of data.sections){
    for (const day of (section.days || [])){
      const key = makePanel(section, day);
      const isMB = (section.id === "m2b" || section.id === "b2m");
      const targetPicker = isMB ? pickerMB : pickerMO;
      addPickerButton(targetPicker, `${section.title} — ${day.name}`, key);
    }
  }

  // selecció inicial: primer botó, sense scroll
  const firstBtnMB = pickerMB.querySelector("button");
  const firstBtnMO = pickerMO.querySelector("button");
  const firstBtn = firstBtnMB || firstBtnMO;
  if (firstBtn){
    const key = firstBtn.getAttribute("data-key");
    const targetPicker = firstBtnMB ? pickerMB : pickerMO;
    selectPanel(panelByKey, panels, targetPicker, key, firstBtn, false);
  } else {
    if (loading) loading.textContent = "No hi ha botons (no hi ha seccions).";
  }
}

// --- Toggle accessible: botó + aria-expanded + div hidden ---
document.addEventListener("click", function(e) {
  const btn = e.target.closest?.(".trip-toggle");
  if (!btn) return;

  const id = btn.getAttribute("aria-controls");
  const panel = document.getElementById(id);
  if (!panel) return;

  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", expanded ? "false" : "true");
  panel.hidden = expanded;
});

// Carrega data.json (cache-busting suau)
(function loadData(){
  const loading = document.getElementById("loading");
  const url = new URL("data.json", window.location.href);
  url.searchParams.set("v", "9");

  fetch(url.toString(), {cache:"no-store"})
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} - No s'ha trobat data.json`);
      return r.json();
    })
    .then(data => {
      try { buildUI(data); }
      catch(e){
        console.error(e);
        if (loading) loading.textContent = "Error mostrant horaris (JS). Mira la consola.";
      }
    })
    .catch(err => {
      console.error(err);
      if (loading) loading.textContent = "Error carregant dades: " + (err?.message || String(err));
    });
})();
