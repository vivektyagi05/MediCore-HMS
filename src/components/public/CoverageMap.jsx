import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MapPinned, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";

const INDIA_STATES_GEOJSON =
  "https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson";

function MapViewport({ selectedState }) {
  const map = useMap();
  useEffect(() => {
    // P23 Section 36 regression fix — guard against calling setView on a
    // map instance whose container has already been torn down (React
    // strict-mode double-invoke / fast unmount-remount during navigation).
    // Leaflet's own pan/zoom animation frame callback reads internal DOM
    // position caches (`_leaflet_pos`) on the container and its panes; if
    // the container is gone those reads throw the exact reported
    // "Cannot read properties of undefined (reading '_leaflet_pos')".
    if (!map || !map._loaded || !map.getContainer()) return undefined;
    let cancelled = false;
    // Defer to the next frame so this never fires in the same tick as an
    // in-flight GeoJSON layer swap (see below) — the two must never
    // animate/mutate the map's panes in the same synchronous frame.
    const frame = requestAnimationFrame(() => {
      if (cancelled || !map._loaded || !map.getContainer()) return;
      map.setView([22.5, 79], selectedState ? 5.3 : 4.6, { animate: true });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [map, selectedState]);
  return null;
}

const featureName = (feature) =>
  feature?.properties?.ST_NM ||
  feature?.properties?.st_nm ||
  feature?.properties?.NAME_1 ||
  feature?.properties?.name ||
  "";

export default function CoverageMap({ coverage, selectedState = "", selectedDistrict = "", onSelectState, onSelectDistrict = () => {} }) {
  const { t } = useI18n();
  const [geojson, setGeojson] = useState(null);
  const [geoError, setGeoError] = useState("");
  const [loading, setLoading] = useState(true);
  const geoJsonLayerRef = useRef(null);

  const loadGeoJson = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setGeoError("");
    fetch(INDIA_STATES_GEOJSON, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Map data unavailable");
        return response.json();
      })
      .then((data) => setGeojson(data))
      .catch((error) => {
        if (error.name !== "AbortError") setGeoError(t("p12.coverage.mapDataError"));
      })
      .finally(() => setLoading(false));
    return controller;
  }, [t]);

  useEffect(() => {
    const controller = loadGeoJson();
    return () => controller.abort();
  }, [loadGeoJson]);

  const stateMap = useMemo(
    () => new Map((coverage?.states || []).map((item) => [item.name.toLowerCase(), item])),
    [coverage],
  );

  const selected = selectedState.trim().toLowerCase();
  const normalizedState = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const style = useCallback((feature) => {
    const name = featureName(feature);
    const item = stateMap.get(normalizedState(name)) || stateMap.get(normalizedState(name).replace("telengana", "telangana"));
    const active = selected && name.toLowerCase() === selected;
    const hasCoverage = Boolean(item?.doctorCount);
    return {
      color: active ? "#c2410c" : "#cbd5e1",
      weight: active ? 2.5 : 1,
      fillColor: hasCoverage ? "#fed7aa" : "#f8fafc",
      fillOpacity: active ? 0.95 : hasCoverage ? 0.72 : 0.8,
    };
  }, [stateMap, selected]);

  // P23 Section 36 regression fix — AUDIT FINDING: the previous
  // implementation used `key={selectedState || "all"}` on <GeoJSON>,
  // forcing React to fully unmount and recreate the entire vector layer
  // (hundreds of polygon paths) on every single state selection, WHILE
  // MapViewport's `map.setView(..., { animate: true })` was simultaneously
  // running a pan/zoom animation. Leaflet's animation frame handler holds
  // references into the layer's DOM nodes; when those nodes were destroyed
  // mid-animation by the GeoJSON remount, the next animation tick read a
  // position cache off an element that no longer existed — the reported
  // "Cannot read properties of undefined (reading '_leaflet_pos')" crash.
  //
  // Fix: the GeoJSON layer is now created exactly once (stable, unkeyed,
  // with a `data` reference that never changes after the initial fetch)
  // and never remounted. Restyling and tooltip updates on selection/
  // coverage changes are applied imperatively to the already-mounted
  // layers via geoJsonLayerRef, which never touches the DOM lifecycle
  // Leaflet's own animation loop depends on.
  useEffect(() => {
    const group = geoJsonLayerRef.current;
    if (!group || typeof group.eachLayer !== "function") return;
    group.eachLayer((layer) => {
      if (!layer?.feature) return;
      try {
        layer.setStyle(style(layer.feature));
        const name = featureName(layer.feature);
        const item = stateMap.get(normalizedState(name)) || stateMap.get(normalizedState(name).replace("telengana", "telangana"));
        layer.setTooltipContent(
          item?.doctorCount
            ? `${name} · ${item.doctorCount} ${t("p12.coverage.doctors")}`
            : `${name} · ${t("p12.coverage.noPublishedCoverage")}`,
        );
      } catch {
        // Defensive — a layer mid-removal during an unrelated map
        // transition should never crash the whole map; skip it silently
        // and let the next effect run reconcile it.
      }
    });
  }, [style, stateMap, t]);

  const handlers = (feature) => ({
    click: () => {
      const name = featureName(feature);
      const item = stateMap.get(normalizedState(name)) || stateMap.get(normalizedState(name).replace("telengana", "telangana"));
      if (item) onSelectState(name === selectedState ? "" : item.name);
    },
    mouseover: (event) => event.target.setStyle({ weight: 2, fillOpacity: 0.95 }),
    mouseout: (event) => event.target.setStyle(style(feature)),
  });

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
        <div className="relative min-h-[390px] border-b border-slate-200 lg:border-b-0 lg:border-r">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-sm font-semibold text-slate-600">
              {t("p12.coverage.loadingMap")}
            </div>
          )}
          {geoError ? (
            <div className="flex min-h-[390px] flex-col items-center justify-center px-6 text-center">
              <MapPinned className="text-orange-600" size={28} />
              <p className="mt-3 text-sm font-black text-slate-900">{t("p12.coverage.mapUnavailable")}</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{geoError}</p>
              <button type="button" onClick={loadGeoJson} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">
                <RefreshCw size={14} /> {t("p12.coverage.retry")}
              </button>
            </div>
          ) : (
            <MapContainer center={[22.5, 79]} zoom={4.6} minZoom={4} maxZoom={7} scrollWheelZoom={false} className="h-[390px] w-full">
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapViewport selectedState={selectedState} />
              {geojson && (
                <GeoJSON
                  ref={geoJsonLayerRef}
                  data={geojson}
                  style={style}
                  onEachFeature={(feature, layer) => {
                    const item = stateMap.get(normalizedState(featureName(feature))) || stateMap.get(normalizedState(featureName(feature)).replace("telengana", "telangana"));
                    layer.bindTooltip(
                      item?.doctorCount
                        ? `${featureName(feature)} · ${item.doctorCount} ${t("p12.coverage.doctors")}`
                        : `${featureName(feature)} · ${t("p12.coverage.noPublishedCoverage")}`,
                    );
                    layer.on(handlers(feature));
                  }}
                />
              )}
            </MapContainer>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600">
              <MapPinned size={18} />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">{t("p12.coverage.eyebrow")}</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">{t("p12.coverage.title")}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{t("p12.coverage.description")}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-black text-slate-950">{coverage?.totalDoctors ?? "—"}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">{t("p12.coverage.publishedDoctors")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-black text-slate-950">{coverage?.states?.length ?? "—"}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">{t("p12.coverage.states")}</p>
            </div>
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-bold text-slate-700">{t("p12.coverage.chooseState")}</span>
            <select value={selectedState} onChange={(e) => onSelectState(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100">
              <option value="">{t("p12.coverage.allStates")}</option>
              {(coverage?.states || []).map((state) => (
                <option key={state.name} value={state.name}>
                  {state.name} · {state.doctorCount}
                </option>
              ))}
            </select>
          </label>

          {selectedState && (coverage?.districts || []).filter((item) => normalizedState(item.state) === normalizedState(selectedState)).length > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-800">{t("p12.coverage.districts")}</p>
              <div className="mt-3 max-h-36 space-y-1 overflow-y-auto pr-1">
                {(coverage?.districts || []).filter((item) => normalizedState(item.state) === normalizedState(selectedState)).map((district) => (
                  <button type="button" key={district.name} onClick={() => onSelectDistrict(district.name)} aria-pressed={selectedDistrict === district.name} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${selectedDistrict === district.name ? "bg-orange-100 text-orange-800" : "bg-slate-50 text-slate-700"}`}>
                    <span className="font-semibold">{district.name}</span>
                    <span className="font-black text-slate-900">{district.doctorCount}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedState && (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-black text-slate-900">{selectedState}</p>
              <p className="mt-1 text-sm text-slate-600">
                {stateMap.get(selected.toLowerCase())?.doctorCount ?? 0} {t("p12.coverage.publishedDoctors")}
              </p>
              <button type="button" onClick={() => onSelectState("")} className="mt-3 text-sm font-black text-orange-700">
                {t("p12.coverage.clearState")}
              </button>
            </div>
          )}
          <p className="mt-5 text-xs leading-5 text-slate-500">{t("p12.coverage.attribution")}</p>
        </div>
      </div>
    </div>
  );
}

export { INDIA_STATES_GEOJSON };
