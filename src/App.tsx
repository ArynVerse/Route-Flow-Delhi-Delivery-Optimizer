import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Fix: Leaflet's default marker icons break in production builds
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type Stop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: "warehouse" | "delivery";
};

type RouteResult = {
  distance: number;
  duration: number;
  geometry: [number, number][];
};

const DELHI_CENTER: [number, number] = [28.6139, 77.2090];

const PRESETS: Stop[] = [
  { id: "warehouse", name: "Warehouse — Connaught Place", lat: 28.6315, lon: 77.2167, type: "warehouse" },
  { id: "india-gate", name: "India Gate", lat: 28.6129, lon: 77.2295, type: "delivery" },
  { id: "karol-bagh", name: "Karol Bagh", lat: 28.6514, lon: 77.1907, type: "delivery" },
  { id: "lajpat", name: "Lajpat Nagar", lat: 28.5677, lon: 77.2433, type: "delivery" },
  { id: "hauz-khas", name: "Hauz Khas", lat: 28.5494, lon: 77.2001, type: "delivery" },
  { id: "saket", name: "Saket", lat: 28.5245, lon: 77.2066, type: "delivery" },
  { id: "dwarka", name: "Dwarka Sector 10", lat: 28.5921, lon: 77.0460, type: "delivery" }
];

const OSRM = "https://router.project-osrm.org";

function haversine(a: Stop, b: Stop) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function nearestNeighborOrder(
  warehouse: Stop,
  deliveries: Stop[],
  matrix: number[][]
) {
  const all = [warehouse, ...deliveries];
  const remaining = new Set(deliveries.map((_, i) => i + 1));
  const order = [0];
  let current = 0;

  while (remaining.size) {
    let best = -1;
    let bestCost = Infinity;
    for (const candidate of remaining) {
      const cost = matrix[current][candidate];
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }

  return order.map((i) => all[i]);
}

async function getTable(stops: Stop[]) {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(";");
  const url = `${OSRM}/table/v1/driving/${coords}?annotations=distance,duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Routing table request failed");
  return res.json() as Promise<{ code: string; distances: (number | null)[][]; durations: (number | null)[][] }>;
}

async function getRoute(stops: Stop[]): Promise<RouteResult> {
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(";");
  const url =
    `${OSRM}/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Route request failed");
  const data = await res.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || "No route found");
  }

  const route = data.routes[0];
  const geometry = route.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon] as [number, number]
  );

  return {
    distance: route.distance,
    duration: route.duration,
    geometry
  };
}

function App() {
  const mapRef = useRef<L.Map | null>(null);
  const mapElement = useRef<HTMLDivElement | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);

  const [warehouse] = useState(PRESETS[0]);
  const [deliveries, setDeliveries] = useState<Stop[]>(PRESETS.slice(1, 6));
  const [routeStops, setRouteStops] = useState<Stop[]>([warehouse, ...PRESETS.slice(1, 6)]);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [speed, setSpeed] = useState(35);
  const [message, setMessage] = useState("Ready — choose delivery points and optimize.");

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    const map = L.map(mapElement.current, {
      center: DELHI_CENTER,
      zoom: 11,
      zoomControl: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    markersLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on("click", (e: L.LeafletMouseEvent) => {
      const id = `custom-${Date.now()}`;
      const stop: Stop = {
        id,
        name: `Custom Stop ${deliveries.length + 1}`,
        lat: e.latlng.lat,
        lon: e.latlng.lng,
        type: "delivery"
      };
      setDeliveries((prev) => [...prev, stop]);
      setRouteStops((prev) => [...prev, stop]);
      setMessage("Custom delivery point added.");
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markersLayer.current) return;
    markersLayer.current.clearLayers();

    const all = [warehouse, ...deliveries];

    all.forEach((stop, index) => {
      const marker = L.marker([stop.lat, stop.lon], {
        title: stop.name
      }).addTo(markersLayer.current!);

      marker.bindPopup(
        `<b>${index === 0 ? "🏭 " : "📦 "}${stop.name}</b><br/>` +
        `${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`
      );
    });
  }, [warehouse, deliveries]);

  useEffect(() => {
    if (!mapRef.current || !result) return;

    routeLayer.current?.remove();

    routeLayer.current = L.polyline(result.geometry, {
      weight: 6,
      opacity: 0.9
    }).addTo(mapRef.current);

    mapRef.current.fitBounds(routeLayer.current.getBounds(), {
      padding: [30, 30]
    });
  }, [result]);

  const estimatedBySpeed = useMemo(() => {
    if (!result) return 0;
    return Math.round((result.distance / 1000 / speed) * 60);
  }, [result, speed]);

  async function calculateCurrentRoute() {
    if (routeStops.length < 2) return;
    setLoading(true);
    setMessage("Calculating real road route...");
    try {
      const data = await getRoute(routeStops);
      setResult(data);
      setMessage("Real Delhi road route calculated successfully.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not calculate route.");
    } finally {
      setLoading(false);
    }
  }

  async function optimizeDeliveries() {
    if (!deliveries.length) return;
    setOptimizing(true);
    setMessage("Building distance matrix and optimizing delivery order...");

    try {
      const stops = [warehouse, ...deliveries];
      const table = await getTable(stops);

      const matrix = table.distances.map((row) =>
        row.map((v) => (v == null ? Infinity : v))
      );

      const ordered = nearestNeighborOrder(warehouse, deliveries, matrix);
      setRouteStops(ordered);

      const route = await getRoute(ordered);
      setResult(route);

      setMessage(
        `Optimized ${deliveries.length} deliveries using a greedy nearest-neighbor strategy.`
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Optimization failed.");
    } finally {
      setOptimizing(false);
    }
  }

  function toggleDelivery(stop: Stop) {
    setDeliveries((prev) =>
      prev.some((x) => x.id === stop.id)
        ? prev.filter((x) => x.id !== stop.id)
        : [...prev, stop]
    );
    setRouteStops([warehouse, ...deliveries.filter((x) => x.id !== stop.id)]);
    setResult(null);
  }

  function reset() {
    setDeliveries(PRESETS.slice(1, 6));
    setRouteStops([warehouse, ...PRESETS.slice(1, 6)]);
    setResult(null);
    routeLayer.current?.remove();
    setMessage("Reset to the default Delhi delivery points.");
    mapRef.current?.setView(DELHI_CENTER, 11);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">🚚 RouteFlow</div>
          <div className="subtitle">Delhi Delivery Route Optimizer</div>
        </div>
        <div className="online"><span /> Live Map</div>
      </header>

      <main className="layout">
        <aside className="panel">
          <div className="eyebrow">DSA PROJECT</div>
          <h1>Smart Delivery Routing</h1>
          <p className="intro">
            Real Delhi road network + route optimization. Click anywhere on the
            map to add a custom delivery point.
          </p>

          <div className="section-title">Warehouse</div>
          <div className="warehouse-card">
            <b>🏭 {warehouse.name}</b>
            <small>{warehouse.lat.toFixed(4)}, {warehouse.lon.toFixed(4)}</small>
          </div>

          <div className="section-title">
            Delivery Points <span>{deliveries.length}</span>
          </div>

          <div className="stops">
            {PRESETS.slice(1).map((stop) => {
              const active = deliveries.some((x) => x.id === stop.id);
              return (
                <button
                  key={stop.id}
                  className={`stop ${active ? "active" : ""}`}
                  onClick={() => toggleDelivery(stop)}
                >
                  <span className="checkbox">{active ? "✓" : ""}</span>
                  <span>{stop.name}</span>
                </button>
              );
            })}

            {deliveries
              .filter((x) => x.id.startsWith("custom-"))
              .map((stop) => (
                <button key={stop.id} className="stop active" onClick={() => toggleDelivery(stop)}>
                  <span className="checkbox">✓</span>
                  <span>{stop.name}</span>
                </button>
              ))}
          </div>

          <label className="speed-label">
            Average delivery speed: <b>{speed} km/h</b>
          </label>
          <input
            type="range"
            min="15"
            max="60"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />

          <button className="primary" disabled={optimizing || loading} onClick={optimizeDeliveries}>
            {optimizing ? "Optimizing..." : "⚡ Optimize Delivery Route"}
          </button>

          <button className="secondary" disabled={loading} onClick={calculateCurrentRoute}>
            {loading ? "Calculating..." : "🗺️ Calculate Selected Order"}
          </button>

          <button className="reset" onClick={reset}>Reset</button>

          <div className="algorithm">
            <div>ALGORITHM</div>
            <b>Greedy + OSRM Graph Routing</b>
            <small>Distance matrix → nearest-neighbor → real road geometry</small>
          </div>
        </aside>

        <section className="content">
          <div className="map-card">
            <div className="map-toolbar">
              <div>
                <b>Delhi Road Network</b>
                <span>OpenStreetMap data</span>
              </div>
              <div className="hint">Click map to add delivery</div>
            </div>
            <div ref={mapElement} className="map" />
          </div>

          <div className="stats">
            <div><span>Distance</span><b>{result ? `${(result.distance / 1000).toFixed(1)} km` : "—"}</b></div>
            <div><span>Road ETA</span><b>{result ? `${Math.round(result.duration / 60)} min` : "—"}</b></div>
            <div><span>Delivery ETA</span><b>{estimatedBySpeed ? `${estimatedBySpeed} min` : "—"}</b></div>
            <div><span>Stops</span><b>{deliveries.length}</b></div>
          </div>

          <div className="result-card">
            <div>
              <b>Optimized Stop Order</b>
              <span>{message}</span>
            </div>

            <div className="route-order">
              {routeStops.map((stop, i) => (
                <div className="route-stop" key={`${stop.id}-${i}`}>
                  <strong>{i + 1}</strong>
                  <span>{stop.name.replace(" — Connaught Place", "")}</span>
                  {i < routeStops.length - 1 && <i>→</i>}
                </div>
              ))}
            </div>
          </div>

          <div className="note">
            <b>How the DSA part works:</b> OSRM provides real road distances between
            points. The app builds a distance matrix, then a greedy nearest-neighbor
            algorithm chooses the next closest unvisited delivery. The final ordered
            stops are sent to the routing engine to draw the actual Delhi road route.
          </div>
        </section>
      </main>

      <footer>
        RouteFlow • Built with React + TypeScript + Leaflet + OpenStreetMap + OSRM
      </footer>
    </div>
  );
}

export default App;