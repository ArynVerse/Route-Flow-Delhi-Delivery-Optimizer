# RouteFlow — Delhi Delivery Route Optimizer

Real Delhi map prototype using React + TypeScript + Leaflet + OpenStreetMap + OSRM.

## Run
```bash
npm install
npm run dev
```

## What it does
- Shows a real OpenStreetMap map centered on Delhi.
- Includes preset warehouse/delivery locations.
- Click the map to add custom delivery points.
- Uses OSRM Table API to build a road-distance matrix.
- Uses a greedy nearest-neighbor algorithm to optimize delivery order.
- Uses OSRM Route API to draw the real road route.
- Shows route distance and ETA.

## Notes
The public OSRM demo server is intended for demonstrations/testing, not production-scale traffic. For a college prototype this is convenient; for production, host your own routing backend or use a suitable commercial routing provider.
