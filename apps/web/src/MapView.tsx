import "./leaflet-global.ts";
import type { EventDetail, NearbyEvent } from "@eonet/shared/read-api";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useEffect, useRef } from "preact/hooks";

export interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  searchPoint: LatLon | null;
  radiusKm: number;
  events: NearbyEvent[];
  selectedId: string | null;
  selected: EventDetail | null;
  onPickPoint: (point: LatLon) => void;
  onSelect: (id: string) => void;
}

interface Layers {
  map: L.Map;
  pin: L.Marker | null;
  radius: L.Circle | null;
  markers: L.MarkerClusterGroup;
  track: L.LayerGroup;
}

const pinIcon = L.divIcon({ className: "search-pin", iconSize: [22, 22], iconAnchor: [11, 22] });

function eventIcon(event: NearbyEvent, selected: boolean) {
  const category = event.categories[0] ?? "other";
  return L.divIcon({
    className: `event-dot category-${category}${selected ? " selected" : ""}`,
    iconSize: selected ? [18, 18] : [12, 12],
  });
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { worldCopyJump: true }).setView([30, -40], 3);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Events: <a href="https://eonet.gsfc.nasa.gov/">NASA EONET</a>',
    }).addTo(map);
    const markers = L.markerClusterGroup({ maxClusterRadius: 40 }).addTo(map);
    const track = L.layerGroup().addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng.wrap();
      callbacks.current.onPickPoint({ lat, lon: lng });
    });
    layers.current = { map, pin: null, radius: null, markers, track };
    return () => {
      map.remove();
      layers.current = null;
    };
  }, []);

  const { searchPoint, radiusKm } = props;
  useEffect(() => {
    const current = layers.current;
    if (!current || !searchPoint) return;
    const latLng = L.latLng(searchPoint.lat, searchPoint.lon);
    if (!current.pin) {
      current.pin = L.marker(latLng, {
        icon: pinIcon,
        draggable: true,
        title: "Search Point — drag to move",
        zIndexOffset: 1000,
      }).addTo(current.map);
      current.pin.on("dragend", () => {
        const { lat, lng } = current.pin?.getLatLng().wrap() ?? latLng;
        callbacks.current.onPickPoint({ lat, lon: lng });
      });
      current.radius = L.circle(latLng, {
        radius: radiusKm * 1000,
        className: "radius-circle",
        interactive: false,
      }).addTo(current.map);
    } else {
      current.pin.setLatLng(latLng);
      current.radius?.setLatLng(latLng).setRadius(radiusKm * 1000);
    }
    if (current.radius) current.map.fitBounds(current.radius.getBounds(), { padding: [20, 20] });
  }, [searchPoint, radiusKm]);

  const { events, selectedId } = props;
  useEffect(() => {
    const current = layers.current;
    if (!current) return;
    current.markers.clearLayers();
    current.markers.addLayers(
      events.map((event) =>
        L.marker([event.latitude, event.longitude], {
          icon: eventIcon(event, event.id === selectedId),
          title: event.title,
          keyboard: true,
        }).on("click", () => callbacks.current.onSelect(event.id)),
      ),
    );
  }, [events, selectedId]);

  const { selected } = props;
  useEffect(() => {
    const current = layers.current;
    if (!current) return;
    current.track.clearLayers();
    if (!selected) return;
    const points: L.LatLngExpression[] = [];
    for (const geometry of selected.track) {
      if (geometry.geometry.type === "Point") {
        const [lon = 0, lat = 0] = geometry.geometry.coordinates;
        points.push([lat, lon]);
        L.circleMarker([lat, lon], { radius: 4, className: "track-point" }).addTo(current.track);
      } else {
        L.geoJSON(geometry.geometry, { style: { className: "track-polygon" } }).addTo(
          current.track,
        );
      }
    }
    if (points.length > 1) L.polyline(points, { className: "track-line" }).addTo(current.track);
    const bounds = L.featureGroup(current.track.getLayers()).getBounds();
    if (bounds.isValid()) current.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
  }, [selected]);

  return <div ref={container} class="map" role="application" aria-label="Map of nearby Events" />;
}
