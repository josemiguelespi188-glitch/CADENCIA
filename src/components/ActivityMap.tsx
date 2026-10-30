"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { decodePolyline } from "@/lib/polyline";

/**
 * The "simple map" version flagged as the cheap option in CLAUDE.md's
 * "Analyze 360" note: Strava's activity list endpoint already returns a
 * `map.summary_polyline` (a simplified, encoded route) for every
 * activity — and since `/api/strava/sync` already stores each activity's
 * full raw object verbatim (`raw: a`), that polyline has been sitting
 * unused in `strava_activities.raw` all along. No new Strava API call
 * needed, just decoding + drawing it. Leaflet + OpenStreetMap tiles
 * (no account needed), not Mapbox — same reasoning as the rest of this
 * codebase's "no new account/integration unless asked" default.
 *
 * Leaflet touches `window`/`document` at init time, so it's imported
 * dynamically inside this effect rather than at module scope — this
 * component is always client-rendered, but Next still pre-renders
 * "use client" components once on the server, which would otherwise
 * throw.
 */
export function ActivityMap({ polyline }: { polyline: string | null | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!polyline || !containerRef.current) return;
    const points = decodePolyline(polyline);
    if (points.length < 2) return;

    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      const line = L.polyline(points, { color: "#E3F464", weight: 4 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [12, 12] });
      L.circleMarker(points[0], { radius: 5, color: "#F3F3F1", fillColor: "#0B0B0C", fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker(points[points.length - 1], { radius: 5, color: "#0B0B0C", fillColor: "#F3F3F1", fillOpacity: 1, weight: 2 }).addTo(map);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [polyline]);

  if (!polyline) return null;

  return <div ref={containerRef} className="h-56 w-full rounded-xl border border-line" />;
}
