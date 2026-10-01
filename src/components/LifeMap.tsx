"use client";
import { useEffect, useRef } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";

export interface LifeMapProps {
  height?: string;
  center?: [number, number];
  zoom?: number;
  /** GeoJSON FeatureCollection of places to draw */
  places?: GeoJSON.FeatureCollection | null;
  /** Fetch places from the API */
  fetchPlaces?: boolean;
  /** Highlight one polygon and fit to it */
  focus?: GeoJSON.Geometry | null;
  /** The focus is a circle around a hidden location, not a boundary */
  focusApproximate?: boolean;
  /** Enable click-to-draw; called with the closed ring as [lon,lat][] */
  onDraw?: (ring: [number, number][]) => void;
  /** Shows a NASA GIBS MODIS NDVI overlay for this date (YYYY-MM-DD) if set */
  ndviDate?: string | null;
}

const VERDICT_COLOR: Record<string, string> = { thriving: "#2f6b3a", holding: "#8a9a2b", declining: "#b3452b", insufficient: "#7a7a72" };

export default function LifeMap({ height = "70vh", center, zoom = 7, places, fetchPlaces, focus, focusApproximate, onDraw, ndviDate }: LifeMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const drawRef = useRef<{ pts: [number, number][]; layer: LType.Polygon | null; markers: LType.CircleMarker[] }>({ pts: [], layer: null, markers: [] });

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      const map = L.map(el.current, { center: center ?? [52.1, 5.2], zoom, zoomControl: true });
      mapRef.current = map;

      const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
      const s2 = L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg", {
        maxZoom: 17, attribution: 'Sentinel-2 cloudless by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025)',
      });
      const worldcover = L.tileLayer(
        "https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png&TIME=2021-01-01",
        { maxZoom: 14, opacity: 0.6, attribution: "&copy; ESA WorldCover 2021 (CC BY 4.0)" },
      );
      let ndviDay = ndviDate;
      if (ndviDate === "auto") { const d = new Date(Date.now() - 30 * 86400e3); d.setUTCDate(1); ndviDay = d.toISOString().slice(0, 10); } // MODIS 16-day composites lag a few weeks
      const ndvi = ndviDay
        ? L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_NDVI_16Day/default/${ndviDay}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`, { maxZoom: 9, opacity: 0.65, attribution: "NASA GIBS / MODIS Terra NDVI 16-day" })
        : null;
      const labels = L.tileLayer("https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}{r}.png", { maxZoom: 18, opacity: 0.5, attribution: "&copy; Stadia Maps, Stamen Design, OpenStreetMap" });
      s2.addTo(map);
      const base: Record<string, LType.Layer> = { "Sentinel-2 cloudless (2025)": s2, "OpenStreetMap": osm };
      const over: Record<string, LType.Layer> = { "Land cover (ESA WorldCover 2021)": worldcover, "Roads and borders": labels };
      if (ndvi) over[`Greenness (MODIS NDVI, ${ndviDay})`] = ndvi;
      L.control.layers(base, over, { collapsed: true }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);

      const placesLayer = L.geoJSON(undefined, {
        // a place that hides its location is a circle around somewhere near it: dashed, lightly filled
        style: (f) => ({ color: VERDICT_COLOR[(f?.properties?.verdict as string) ?? "insufficient"], weight: 2, fillOpacity: f?.properties?.approximate ? 0.1 : 0.25, dashArray: f?.properties?.approximate ? "6 5" : undefined }),
        onEachFeature: (f, layer) => {
          const p = f.properties ?? {};
          layer.bindPopup(`<strong>${p.name ?? ""}</strong><br/>${Number(p.areaHa ?? 0).toFixed(1)} ha · ${p.observations ?? 0} satellite obs · ${p.devices ?? 0} devices<br/>Verdict: <b>${p.verdict ?? "insufficient"}</b>${p.approximate ? `<br/>Location shown to within ${(Number(p.approximateRadiusM ?? 1000) / 1000).toFixed(1)} km` : ""}<br/><a href="/places/${p.slug}">Open place</a>`);
        },
      }).addTo(map);
      // A field of a few hectares is smaller than a pixel at country or world scale, so every place also gets a
      // pin at its centre. Pins show until the outline itself is large enough to see.
      const PIN_MAX_ZOOM = 12;
      const pins = L.layerGroup();
      const syncPins = () => { if (map.getZoom() <= PIN_MAX_ZOOM) pins.addTo(map); else pins.remove(); };
      map.on("zoomend", syncPins);
      const addPlaces = (fc: GeoJSON.FeatureCollection) => {
        L.geoJSON(fc, {
          onEachFeature: (f, layer) => {
            const p = f.properties ?? {};
            const at = (layer as LType.Polygon).getBounds().getCenter();
            L.circleMarker(at, { radius: 7, color: "#ffffff", weight: 2, fillColor: VERDICT_COLOR[(p.verdict as string) ?? "insufficient"], fillOpacity: 1 })
              .bindTooltip(String(p.name ?? ""))
              .on("click", () => map.setView(at, Math.max(map.getZoom() + 4, 14)))
              .addTo(pins);
          },
        });
        placesLayer.addData(fc);
        syncPins();
      };
      if (places) addPlaces(places);
      if (fetchPlaces) {
        try { const r = await fetch("/api/v1/places?format=geojson"); if (r.ok) { const fc = await r.json(); addPlaces(fc); if (!focus && fc.features?.length && !center) map.fitBounds(placesLayer.getBounds().pad(0.2)); } } catch {}
      }
      if (focus) {
        const fl = L.geoJSON(focus as GeoJSON.GeoJsonObject, { style: focusApproximate ? { color: "#1b1f1a", weight: 2, fillOpacity: 0.08, dashArray: "8 6" } : { color: "#1b1f1a", weight: 3, fillOpacity: 0.05, dashArray: "4 3" } }).addTo(map);
        map.fitBounds(fl.getBounds().pad(focusApproximate ? 0.15 : 0.6));
      }
      if (onDraw) {
        const d = drawRef.current;
        const redraw = () => {
          d.layer?.remove();
          d.layer = d.pts.length >= 3 ? L.polygon(d.pts.map(([lon, lat]) => [lat, lon]), { color: "#2f6b3a", weight: 2, fillOpacity: 0.2 }).addTo(map) : null;
        };
        map.on("click", (e: LType.LeafletMouseEvent) => {
          d.pts.push([e.latlng.lng, e.latlng.lat]);
          d.markers.push(L.circleMarker(e.latlng, { radius: 4, color: "#2f6b3a" }).addTo(map));
          redraw();
          if (d.pts.length >= 3) onDraw([...d.pts, d.pts[0]]);
        });
        map.on("contextmenu", () => { d.pts = []; d.markers.forEach((m) => m.remove()); d.markers = []; redraw(); onDraw([]); });
      }
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={el} style={{ height, width: "100%" }} className="rounded-lg border border-line overflow-hidden bg-[#dfe6dc]" />;
}
