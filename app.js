// Accessible rendering for TalkBack/VoiceOver (12 botons + lectura fluida)
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

function summaryAria(tr, bt){
  return `Sortida ${tr.start_time}. Arribada ${tr.end_time}. Servei ${speakBusType(bt)}.`;
}

function makeTripDetails(tr, bt){
  const details = el("details", { class: "trip" });

  // IMPORTANT: un sol text node al summary per lectura seguida
  const visible = `Servei ${speakBusType(bt)}. Sortida ${tr.start_time}. Arribada ${tr.end_time}.`;
  const summary = el("summary", { "aria-label": summaryAria(tr, bt) }, [
    document.createTextNode(visible)
  ]);

  details.appendChild(summary);

  const inner = el("div", { class: "inner" });

  // Frase “tot seguit”
  inner.appendChild(el("p", { class: "route-sentence" }, [
    document.createTextNode(routeSentence(tr.stops))
  ]));

  // Llista (una a una)
  const ol = el("ol", {});
  for (const st of tr.stops) {
    const li = el("li", {});
    li.appendChild(el("time", { datetime: st.time, text: st.time }));
    li.appendChild(document.createTextNode(" — " + st.stop));
    ol.appendChild(li);
  }
  inner.appendChild(ol);

  details.appendChild(inner);
  return details;
}

function buildUI(data){
  const picker = document.getElementById("picker");
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

  // Sort order: as requested (4 blocs en ordre sec, i dins dia en ordre del JSON)
  // Assume sec order already correct in data.json

  // Panels
  for (const e of entries){
    const panel = el("div", { class: "panel", id: `panel_${cssSafe(e.key)}`, "aria-hidden": "true" });

    const h = el("h3", { id: `ph_${cssSafe(e.key)}` }, [
      document.createTextNode(`${e.sec.title} — ${e.day.name}`)
    ]);
    panel.appendChild(h);

    // Bus groups ordered (e22/e23 then semidirecte)
    // Dins de cada secció: 2 botons (Directes / Semidirectes)
    const kindWrap = el("div", { class: "kind-picker", role: "group", "aria-label": "Filtre de serveis" });
    const btnDirect = el("button", { type: "button", class: "kind-btn", "aria-pressed": "false" }, [document.createTextNode("Directes")]);
    const btnSemi = el("button", { type: "button", class: "kind-btn", "aria-pressed": "false" }, [document.createTextNode("Semidirectes")]);
    kindWrap.appendChild(btnDirect);
    kindWrap.appendChild(btnSemi);
    panel.appendChild(kindWrap);

    const directBox = el("div", { class: "kind-panel", "data-kind": "direct" });
    const semiBox = el("div", { class: "kind-panel", "data-kind": "semi" });
    panel.appendChild(directBox);
    panel.appendChild(semiBox);

    const order = e.sec.busTypeOrder || ["e22","e23","semidirecte"];
    let hasDirect = false;
    let hasSemi = false;

    for (const bt of order){
      const trips = (e.day.buses && e.day.buses[bt]) ? e.day.buses[bt] : [];
      if (!trips.length) continue;

      const grp = el("div", { class:"bus-group" });
      grp.appendChild(el("h4", { text: speakBusType(bt) }));

      for (const tr of trips){
        tripUid += 1;
        grp.appendChild(makeTrip(tr, bt, tripUid));
      }

      if (bt === "semidirecte"){
        hasSemi = true;
        semiBox.appendChild(grp);
      } else {
        hasDirect = true;
        directBox.appendChild(grp);
      }
    }

    function showKind(kind){
      const isDirect = kind === "direct";
      btnDirect.setAttribute("aria-pressed", isDirect ? "true" : "false");
      btnSemi.setAttribute("aria-pressed", isDirect ? "false" : "true");

      if (isDirect){
        directBox.removeAttribute("hidden");
        semiBox.setAttribute("hidden", "");
      } else {
        semiBox.removeAttribute("hidden");
        directBox.setAttribute("hidden", "");
      }
    }

    if (!hasDirect){
      btnDirect.disabled = true;
      btnDirect.setAttribute("aria-disabled","true");
    }
    if (!hasSemi){
      btnSemi.disabled = true;
      btnSemi.setAttribute("aria-disabled","true");
    }

    btnDirect.addEventListener("click", () => showKind("direct"));
    btnSemi.addEventListener("click", () => showKind("semi"));

    showKind(hasDirect ? "direct" : "semi");
      panel.appendChild(group);
    }

    panels.appendChild(panel);
  }

  // Buttons
  let firstKey = null;
  for (const e of entries){
    if (!firstKey) firstKey = e.key;

    const btn = el("button", {
      type: "button",
      "data-target": e.key,
      "aria-pressed": "false"
    }, []);

    // Text visible: 2 línies, però sense tags dins frase (lector ho llegeix bé igual)
    const line1 = `${e.sec.title}`;
    const line2 = `${e.day.name}`;
    btn.appendChild(el("span", { text: line1 }));
    btn.appendChild(el("span", { class:"visually-hidden", text:" — " }));
    btn.appendChild(el("span", { text: " " + line2 }));

    btn.addEventListener("click", () => select(e.key));
    picker.appendChild(btn);
  }

  function select(key){
    // Update buttons
    for (const b of picker.querySelectorAll("button")){
      const active = b.getAttribute("data-target") === key;
      b.setAttribute("aria-pressed", active ? "true" : "false");
    }
    // Update panels
    for (const p of panels.querySelectorAll(".panel")){
      const isTarget = p.id === `panel_${cssSafe(key)}`;
      p.setAttribute("aria-hidden", isTarget ? "false" : "true");
    }
    // Move focus to panel heading (nice for TalkBack/VoiceOver)
    const heading = document.getElementById(`ph_${cssSafe(key)}`);
    if (heading) heading.focus?.();
    // If focus() doesn't work on heading, set tabindex and focus
    if (heading && !heading.hasAttribute("tabindex")){
      heading.setAttribute("tabindex","-1");
      heading.focus();
    }
  }

  // Default selection
  select(firstKey);
}

function cssSafe(s){
  // Safe id
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

fetch("data.json")
  .then(r => r.json())
  .then(buildUI)
  .catch(() => {
    const loading = document.getElementById("loading");
    if (loading) loading.textContent = "Error carregant dades.";
  });
