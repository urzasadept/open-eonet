// leaflet.markercluster is a UMD build that extends a global `L`, so expose Leaflet before importing it.
import L from "leaflet";

(globalThis as { L?: typeof L }).L = L;
