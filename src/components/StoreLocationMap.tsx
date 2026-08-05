/**
 * Peta lokasi toko (Leaflet) — dipisah dari CloudOnlineStoreSettings agar
 * inisialisasi peta, marker, dan sinkronisasi posisi menjadi unit mandiri
 * yang bisa diuji & dipakai ulang.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icons via unpkg CDN to ensure reliability in bundles
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export interface StoreLocationMapHandle {
  /** Fokus marker & view ke koordinat (opsional zoom; default zoom saat ini). */
  setPosition: (lat: number, lng: number, zoom?: number) => void;
}

interface StoreLocationMapProps {
  /** Jangan render peta selama loading (mis. detail toko belum dimuat). */
  loading: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Dipanggil saat user menyeret marker atau klik peta. */
  onChange: (lat: number, lng: number) => void;
}

const StoreLocationMap = forwardRef<StoreLocationMapHandle, StoreLocationMapProps>(
  function StoreLocationMap({ loading, latitude, longitude, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    // Hindari effect restart saat prop onChange berganti identitas.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Inisialisasi peta + sinkronisasi posisi marker dari state.
    useEffect(() => {
      if (loading || !containerRef.current) return;

      const defaultLat = latitude ?? -6.2088;
      const defaultLng = longitude ?? 106.8456;
      const zoomLevel = latitude && longitude ? 15 : 5;

      let map = mapRef.current;
      let marker = markerRef.current;

      if (!map) {
        map = L.map(containerRef.current).setView([defaultLat, defaultLng], zoomLevel);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        marker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(map);

        marker.on('dragend', () => {
          const position = marker?.getLatLng();
          if (position) {
            onChangeRef.current(position.lat, position.lng);
          }
        });

        map.on('click', (e) => {
          marker?.setLatLng(e.latlng);
          onChangeRef.current(e.latlng.lat, e.latlng.lng);
        });

        mapRef.current = map;
        markerRef.current = marker;

        // Force relayout agar tile Leaflet tergambar dengan benar.
        setTimeout(() => {
          map?.invalidateSize();
        }, 100);
      } else if (latitude !== null && longitude !== null) {
        const curLatLng = marker?.getLatLng();
        if (!curLatLng || curLatLng.lat !== latitude || curLatLng.lng !== longitude) {
          marker?.setLatLng([latitude, longitude]);
          map.setView([latitude, longitude], map.getZoom());
        }
      }

      return () => {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
          markerRef.current = null;
        }
      };
    }, [latitude, longitude, loading]);

    // Fokus marker secara imperatif (mis. hasil GPS).
    useImperativeHandle(
      ref,
      () => ({
        setPosition(lat, lng, zoom) {
          markerRef.current?.setLatLng([lat, lng]);
          const map = mapRef.current;
          if (map) {
            if (zoom !== undefined) map.setView([lat, lng], zoom);
            else map.setView([lat, lng], map.getZoom());
          }
        },
      }),
      [],
    );

    return <div ref={containerRef} className="h-56 rounded-xl border relative z-10 w-full overflow-hidden" />;
  },
);

export default StoreLocationMap;
