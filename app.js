// Accessible rendering: list-first, optional table view
function el(tag, attrs={}, children=[]) {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}
function timeTag(t){
  return el("time", { datetime: t }, [document.createTextNode(t)]);
}

function renderDirection(containerId, loadingId, directionKey, data){
  const container = document.getElementById(containerId);
  const loading = document.getElementById(loadingId);
  loading.textContent = "";

  const days = data?.direccions?.[directionKey];
  if (!days) {
    loading.textContent = "No hi ha dades per aquesta direcció.";
    return;
  }

  for (const [dayName, buses] of Object.entries(days)) {
    const dayBlock = el("div", { class:"day-block" });
    dayBlock.appendChild(el("h3", {}, [document.createTextNode(dayName)]));

    for (const [busType, trips] of Object.entries(buses)) {
      dayBlock.appendChild(el("p", {}, [
        document.createTextNode("Servei "),
        el("strong", {}, [document.createTextNode(busType)]),
        document.createTextNode(". Toca un servei per escoltar la llista de parades.")
      ]));

      // List view (best for TalkBack/VoiceOver)
      for (const tr of trips) {
        const summaryText = `Sortida ${tr.start_time} — Arribada ${tr.end_time}`;
        const details = el("details", { class:"trip" });
        const summary = el("summary", {}, [
          document.createTextNode(summaryText),
          el("span", { class:"badge", "aria-label":`Tipus de bus ${busType}` }, [document.createTextNode(busType)])
        ]);
        details.appendChild(summary);

        const inner = el("div", { class:"inner" });
        const ol = el("ol", {});
        for (const st of tr.stops) {
          const li = el("li", {});
          li.appendChild(timeTag(st.time));
          li.appendChild(document.createTextNode(" — " + st.stop));
          ol.appendChild(li);
        }
        inner.appendChild(ol);
        details.appendChild(inner);
        dayBlock.appendChild(details);
      }

      // Optional table view (folded)
      const tableDetails = el("details", { class:"trip" });
      tableDetails.appendChild(el("summary", {}, [document.createTextNode("Veure en format taula (opcional)")]));

      const stopOrder = [];
      const seen = new Set();
      for (const tr of trips) {
        for (const st of tr.stops) {
          if (!seen.has(st.stop)) { seen.add(st.stop); stopOrder.push(st.stop); }
        }
      }

      const tableWrap = el("div", { class:"inner" });
      const wrap = el("div", { class:"table-wrap" });
      const table = el("table", {});
      table.appendChild(el("caption", {}, [document.createTextNode(`${dayName} — ${busType} — ${directionKey}`)]));

      const thead = el("thead", {});
      const headRow = el("tr", {});
      headRow.appendChild(el("th", { scope:"col" }, [document.createTextNode("Servei")]));
      for (const stop of stopOrder) {
        headRow.appendChild(el("th", { scope:"col" }, [document.createTextNode(stop)]));
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = el("tbody", {});
      for (const tr of trips) {
        const r = el("tr", {});
        r.appendChild(el("th", { scope:"row" }, [document.createTextNode(`${tr.start_time}–${tr.end_time}`)]));
        const map = new Map(tr.stops.map(s => [s.stop, s.time]));
        for (const stop of stopOrder) {
          r.appendChild(el("td", {}, [document.createTextNode(map.get(stop) || "—")]));
        }
        tbody.appendChild(r);
      }
      table.appendChild(tbody);

      wrap.appendChild(table);
      tableWrap.appendChild(wrap);
      tableDetails.appendChild(tableWrap);
      dayBlock.appendChild(tableDetails);
    }

    container.appendChild(dayBlock);
  }
}

// --- Carrega dades (robust) ---
(function loadData(){
  const loading = document.getElementById("loading");
  const url = new URL("data.json", window.location.href);

  // If the file is missing or blocked, show a clear message instead of "Carregant..." forever.
  fetch(url.toString(), { cache: "no-store" })
    .then(r => {
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} - No s'ha trobat data.json a ${url.pathname}`);
      }
      return r.json();
    })
    .then(data => {
      try {
        buildUI(data);
      } catch (e) {
        console.error(e);
        if (loading) loading.textContent = "Error mostrant horaris (JS). Obre la consola per veure el detall.";
      }
    })
    .catch(err => {
      console.error(err);
      if (loading) loading.textContent = "Error carregant dades: " + (err?.message || String(err));
    });
})();
