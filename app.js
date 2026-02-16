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

function normBusLabel(bt) {
  if (bt === "e22") return "E 22";
  if (bt === "e23") return "E 23";
  return "Semidirecte";
}

function tripHeader(tr, bt) {
  // ordre demanat: Sortida… Arribada… Servei…
  return `Sortida ${tr.start_time}. Arribada ${tr.end_time}. Servei ${normBusLabel(bt)}.`;
}

function routeSentence(tr) {
  // lectura seguida amb tots els temps i parades (una sola frase)
  // separador discret (evitem ·)
  const parts = tr.stops.map(s => `${s.time} ${s.stop}`);
  return `Recorregut: ${parts.join("; ")}.`;
}

function buildUI(data) {
  const loading = document.getElementById("loading");
  const panels = document.getElementById("panels");
  const pickerMB = document.getElementById("picker-mb");
  const pickerMO = document.getElementById("picker-mo");

  if (!data || !Array.isArray(data.sections)) {
    if (loading) loading.textContent = "Error: data.json no té el format esperat (falta sections).";
    return;
  }

  // neteja
  panels.innerHTML = "";
  pickerMB.innerHTML = "";
  pickerMO.innerHTML = "";
  if (loading) loading.textContent = "";

  // crea panells + botons
  const panelByKey = new Map();

  function makePanel(section, day) {
    const key = `${section.id}__${day.name}`;
    const panel = el("div", { class: "panel", "aria-hidden": "true", id: `panel-${key}` });

    panel.appendChild(el("h3", { text: `${section.title} — ${day.name}` }));

    // dos botons dins la secció: directes vs semidirectes
    const btDirect = section.busTypeOrder?.[0] || "e22";
    const btSemi = "semidirecte";

    const btnRow = el("div", { class: "picker", role: "group", "aria-label": "Tria tipus de servei" });
    const btnA = el("button", { type: "button", "aria-pressed": "true" }, [
      document.createTextNode(`Directes (${normBusLabel(btDirect)})`)
    ]);
    const btnB = el("button", { type: "button", "aria-pressed": "false" }, [
      document.createTextNode("Semidirectes")
    ]);
    btnRow.appendChild(btnA);
    btnRow.appendChild(btnB);
    panel.appendChild(btnRow);

    const box = el("div", { class: "bus-group" });
    panel.appendChild(box);

    function renderBusType(bt) {
      box.innerHTML = "";

      const trips = (day.buses && day.buses[bt]) ? day.buses[bt] : [];
      if (!trips.length) {
        box.appendChild(el("p", { class: "muted", text: "No hi ha horaris en aquesta secció." }));
        return;
      }

      for (const tr of trips) {
        const wrap = el("div", { class: "trip" });

        // capçalera (sense desplegable)
        wrap.appendChild(el("p", { class: "route-sentence" }, [
          document.createTextNode(tripHeader(tr, bt))
        ]));

        // una sola frase “Recorregut: ...” amb tota la llista completa
        wrap.appendChild(el("p", { class: "route-sentence" }, [
          document.createTextNode(routeSentence(tr))
        ]));

        box.appendChild(wrap);
      }
    }

    function setPressed(aPressed) {
      btnA.setAttribute("aria-pressed", aPressed ? "true" : "false");
      btnB.setAttribute("aria-pressed", aPressed ? "false" : "true");
    }

    btnA.addEventListener("click", () => { setPressed(true); renderBusType(btDirect); });
    btnB.addEventListener("click", () => { setPressed(false); renderBusType(btSemi); });

    // per defecte: directes
    renderBusType(btDirect);

    panelByKey.set(key, panel);
    panels.appendChild(panel);

    return { key, panel };
  }

  function addPickerButton(targetPicker, label, key) {
    const b = el("button", { type: "button", "aria-pressed": "false" }, [document.createTextNode(label)]);
    b.addEventListener("click", () => {
      // desactiva botons del mateix bloc
      for (const btn of targetPicker.querySelectorAll("button")) btn.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");

      // amaga tots els panells
      for (const p of panels.querySelectorAll(".panel")) p.setAttribute("aria-hidden", "true");

      // mostra el triat
      const panel = panelByKey.get(key);
      if (panel) panel.setAttribute("aria-hidden", "false");

      // mou focus al títol de resultats (lectura més clara)
      const h = document.getElementById("h-result");
      if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    targetPicker.appendChild(b);
  }

  // construeix tot
  for (const section of data.sections) {
    for (const day of section.days || []) {
      const { key } = makePanel(section, day);

      // separa en 2 blocs tal com volies: MB i MO
      const isMB = (section.id === "m2b" || section.id === "b2m");
      const targetPicker = isMB ? pickerMB : pickerMO;

      addPickerButton(targetPicker, `${section.title} — ${day.name}`, key);
    }
  }
}

// --- Carrega dades ---
(function loadData() {
  const loading = document.getElementById("loading");
  const url = new URL("data.json", window.location.href);

  fetch(url.toString(), { cache: "no-store" })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} - No s'ha trobat data.json`);
      return r.json();
    })
    .then(data => buildUI(data))
    .catch(err => {
      console.error(err);
      if (loading) loading.textContent = "Error carregant dades: " + (err?.message || String(err));
    });
})();
