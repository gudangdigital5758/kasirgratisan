import { useState, useEffect, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Store,
  MapPin,
  Phone,
  Clock,
  Globe,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Navigation,
  Check,
  ChevronsUpDown,
  QrCode,
  Download,
  Printer,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import QRCode from 'qrcode';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import LockedPage from '@/components/LockedPage';
import { useCloudAuth } from '@/hooks/use-cloud-auth';
import { useTranslation, Trans } from 'react-i18next';
import {
  fetchStores,
  updateStoreDetails,
  updateStoreIdentifier,
  updateStoreVisibility,
  checkIdentifierAvailability,
  fetchProvinces,
  fetchCities,
  fetchDistricts,
  uploadStoreLogo,
  deleteStoreLogo,
  type CloudStore,
  type DestinationItem,
} from '@/lib/cloud-api';
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

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingPlaceholder?: string;
}

function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Cari...",
  emptyMessage = "Tidak ditemukan.",
  disabled = false,
  loading = false,
  loadingPlaceholder = "Memuat..."
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-10 justify-between font-normal border-input hover:bg-background/80"
          disabled={disabled || loading}
        >
          {loading ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {loadingPlaceholder}
            </span>
          ) : selectedOption ? (
            <span className="truncate">{selectedOption.label}</span>
          ) : (
            <span className="text-muted-foreground truncate">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup className="max-h-[220px] overflow-y-auto">
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{opt.label}</span>
                  <Check
                    className={cn(
                      "h-4 w-4 text-primary shrink-0",
                      value === opt.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type TimeSlot = { open: string; close: string };
type OperationalHours = Record<string, TimeSlot[]>;

const DAYS_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function CloudOnlineStoreSettings() {
  const { can } = useAuth();
  const { isLoggedIn, isSyncSubscribed } = useCloudAuth();
  const { t } = useTranslation('settings');
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const activeStoreId = storeSettings?.cloudStoreId ?? null;

  // Store data states
  const [store, setStore] = useState<CloudStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingIdentifier, setSavingIdentifier] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [provinceId, setProvinceId] = useState<string>('');
  const [cityId, setCityId] = useState<string>('');
  const [districtId, setDistrictId] = useState<string>('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [operationalHours, setOperationalHours] = useState<OperationalHours>({});
  const [isPublic, setIsPublic] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Jakarta');

  // Identifier states
  const [slugInput, setSlugInput] = useState('');
  const [availChecked, setAvailChecked] = useState<boolean | null>(null);
  const [checkingAvail, setCheckingAvail] = useState(false);

  // Destination selections
  const [provinces, setProvinces] = useState<DestinationItem[]>([]);
  const [cities, setCities] = useState<DestinationItem[]>([]);
  const [districts, setDistricts] = useState<DestinationItem[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);

  // Geolocation locating state
  const [locating, setLocating] = useState(false);

  // QR Code states
  const [qrUrl, setQrUrl] = useState<string>('');
  const [templatedQrUrl, setTemplatedQrUrl] = useState<string>('');
  const [hasTemplate, setHasTemplate] = useState<boolean>(false);

  // Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerInstance = useRef<L.Marker | null>(null);

  // Load active store from backend
  const loadStoreDetails = useCallback(async () => {
    if (!activeStoreId) return;
    setLoading(true);
    try {
      const allStores = await fetchStores();
      const linked = allStores.find((s) => s.id === activeStoreId);
      if (linked) {
        setStore(linked);
        setName(linked.name ?? '');
        setPhone(linked.phone ?? '');
        setAddress1(linked.address1 ?? '');
        setAddress2(linked.address2 ?? '');
        setProvinceId(linked.provinceId ? String(linked.provinceId) : '');
        setCityId(linked.cityId ? String(linked.cityId) : '');
        setDistrictId(linked.districtId ? String(linked.districtId) : '');
        setLatitude(linked.latitude ?? null);
        setLongitude(linked.longitude ?? null);
        setSlugInput(linked.identifier ?? '');
        setIsPublic(linked.isPublic ?? false);
        setTimezone(linked.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta');
        setOperationalHours(
          (linked.operationalHours as OperationalHours) || {
            monday: [],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: [],
          }
        );
      }
    } catch {
      toast.error('Gagal memuat detail toko dari cloud');
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  // Generate QR Code URL
  useEffect(() => {
    if (store?.identifier) {
      QRCode.toDataURL(
        `https://market.profitku.my.id/stores/${store.identifier}`,
        {
          width: 512,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        },
        (err, url) => {
          if (err) {
            console.error('Gagal generate QR Code:', err);
            return;
          }
          setQrUrl(url);
        }
      );
    } else {
      setQrUrl('');
    }
  }, [store?.identifier]);

  // Generate Templated QR Code URL
  useEffect(() => {
    if (!store?.identifier || !qrUrl) {
      setTemplatedQrUrl('');
      setHasTemplate(false);
      return;
    }

    const generateTemplatedQR = () => {
      const imgTemplate = new Image();
      imgTemplate.crossOrigin = 'anonymous';
      
      imgTemplate.onload = () => {
        const imgQR = new Image();
        imgQR.onload = () => {
          const canvas = document.createElement('canvas');
          
          const width = imgTemplate.naturalWidth || 810;
          const height = imgTemplate.naturalHeight || 1012.5;
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Draw template SVG
            ctx.drawImage(imgTemplate, 0, 0, width, height);
            
            // Draw QR Code on top of it at the absolute coordinates
            const scaleX = width / 810;
            const scaleY = height / 1012.5;
            
            const qrX = 180 * scaleX;
            const qrY = 181 * scaleY;
            const qrWidth = 450 * scaleX;
            const qrHeight = 450 * scaleY;
            
            ctx.drawImage(imgQR, qrX, qrY, qrWidth, qrHeight);
            
            try {
              const pngUrl = canvas.toDataURL('image/png');
              setTemplatedQrUrl(pngUrl);
              setHasTemplate(true);
            } catch (e) {
              console.error('Gagal export canvas ke data URL:', e);
              setHasTemplate(false);
            }
          }
        };
        imgQR.src = qrUrl;
      };
      
      imgTemplate.onerror = () => {
        console.error('Gagal memuat template SVG');
        setHasTemplate(false);
      };
      
      imgTemplate.src = '/qr-template.svg';
    };

    generateTemplatedQR();
  }, [store?.identifier, qrUrl]);

  const handleDownloadQR = () => {
    if (!qrUrl) return;
    const link = document.createElement('a');
    link.href = qrUrl;
    link.download = `qr-store-${store?.identifier || 'store'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('QR Code berhasil diunduh.');
  };

  const downloadTemplatedQR = () => {
    if (!templatedQrUrl) return;
    const link = document.createElement('a');
    link.href = templatedQrUrl;
    link.download = `qr-store-template-${store?.identifier || 'store'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('QR Code dengan template berhasil diunduh.');
  };

  const handlePrintQR = () => {
    if (!qrUrl) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Gagal membuka jendela cetak. Pastikan pop-up tidak diblokir.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Code - \${store?.name || 'Toko'}</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              font-family: sans-serif;
              background-color: #f9f9f9;
            }
            .container {
              text-align: center;
              border: 1px solid #e2e8f0;
              padding: 40px;
              border-radius: 24px;
              background-color: #ffffff;
              box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
              max-width: 400px;
            }
            img {
              width: 280px;
              height: 280px;
              margin-bottom: 20px;
            }
            h1 {
              margin: 10px 0 5px 0;
              font-size: 22px;
              color: #1e293b;
              font-weight: 700;
            }
            p {
              font-size: 13px;
              color: #64748b;
              margin: 0;
              word-break: break-all;
            }
            .footer {
              margin-top: 30px;
              font-size: 11px;
              color: #94a3b8;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="\${qrUrl}" alt="QR Code" />
            <h1>\${store?.name || 'Toko Online'}</h1>
            <p>market.profitku.my.id/stores/\${store?.identifier}</p>
            <div class="footer">Dicetak melalui Profitku</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() {
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrintTemplatedQR = () => {
    if (!templatedQrUrl) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Gagal membuka jendela cetak. Pastikan pop-up tidak diblokir.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR Code Template - \${store?.name || 'Toko'}</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              font-family: sans-serif;
              background-color: #f9f9f9;
            }
            .container {
              max-width: 450px;
              width: 90%;
              text-align: center;
            }
            img {
              width: 100%;
              height: auto;
              border-radius: 12px;
              box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="\${templatedQrUrl}" alt="QR Code Template" />
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() {
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Load provinces list on mount
  const loadProvincesData = useCallback(async () => {
    setLoadingProvinces(true);
    try {
      setProvinces(await fetchProvinces());
    } catch {
      /* ignore */
    } finally {
      setLoadingProvinces(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn && isSyncSubscribed && activeStoreId) {
      loadStoreDetails();
      loadProvincesData();
    }
  }, [isLoggedIn, isSyncSubscribed, activeStoreId, loadStoreDetails, loadProvincesData]);

  // Load cities list when provinceId changes
  useEffect(() => {
    if (!provinceId) {
      setCities([]);
      return;
    }
    const loadCitiesData = async () => {
      setLoadingCities(true);
      try {
        setCities(await fetchCities(provinceId));
      } catch {
        /* ignore */
      } finally {
        setLoadingCities(false);
      }
    };
    loadCitiesData();
  }, [provinceId]);

  // Load districts list when cityId changes
  useEffect(() => {
    if (!cityId) {
      setDistricts([]);
      return;
    }
    const loadDistrictsData = async () => {
      setLoadingDistricts(true);
      try {
        setDistricts(await fetchDistricts(cityId));
      } catch {
        /* ignore */
      } finally {
        setLoadingDistricts(false);
      }
    };
    loadDistrictsData();
  }, [cityId]);

  // Map Initialization & Updates
  useEffect(() => {
    // If loading is true or container is not available, do nothing
    if (loading || !mapContainerRef.current) {
      return;
    }

    const defaultLat = latitude ?? -6.2088;
    const defaultLng = longitude ?? 106.8456;
    const zoomLevel = latitude && longitude ? 15 : 5;

    let map = mapInstance.current;
    let marker = markerInstance.current;

    // Initialize map if not yet created
    if (!map) {
      map = L.map(mapContainerRef.current).setView([defaultLat, defaultLng], zoomLevel);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      marker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(map);

      // Listen to marker dragend
      marker.on('dragend', () => {
        const position = marker?.getLatLng();
        if (position) {
          setLatitude(position.lat);
          setLongitude(position.lng);
        }
      });

      // Listen to map click
      map.on('click', (e) => {
        marker?.setLatLng(e.latlng);
        setLatitude(e.latlng.lat);
        setLongitude(e.latlng.lng);
      });

      mapInstance.current = map;
      markerInstance.current = marker;

      // Force a relayout to ensure Leaflet renders tiles properly
      setTimeout(() => {
        map?.invalidateSize();
      }, 100);
    } else {
      // Update map view & marker if position changes externally
      if (latitude !== null && longitude !== null) {
        const curLatLng = marker?.getLatLng();
        if (!curLatLng || curLatLng.lat !== latitude || curLatLng.lng !== longitude) {
          marker?.setLatLng([latitude, longitude]);
          map.setView([latitude, longitude], map.getZoom());
        }
      }
    }

    return () => {
      // Clean up map when component unmounts or loading status changes
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markerInstance.current = null;
      }
    };
  }, [latitude, longitude, loading]);

  // Request current GPS coordinates
  const handleGetGPSLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Fitur GPS tidak didukung di browser ini.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setLatitude(lat);
        setLongitude(lng);
        if (mapInstance.current && markerInstance.current) {
          markerInstance.current.setLatLng([lat, lng]);
          mapInstance.current.setView([lat, lng], 15);
        }
        setLocating(false);
        toast.success('Lokasi koordinat GPS berhasil didapatkan.');
      },
      (err) => {
        setLocating(false);
        toast.error(`Gagal mengambil koordinat: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Availability checking for store slug
  const handleCheckIdentifier = async () => {
    const clean = slugInput.trim().toLowerCase();
    if (!clean) return;
    const formatOk = /^[a-z0-9-]+$/.test(clean);
    if (!formatOk) {
      toast.error(t('cloudOnlineStore.identifier.invalid'));
      return;
    }
    setCheckingAvail(true);
    try {
      const ok = await checkIdentifierAvailability(clean);
      setAvailChecked(ok);
    } catch {
      setAvailChecked(false);
      toast.error('Gagal mengecek ketersediaan URL toko.');
    } finally {
      setCheckingAvail(false);
    }
  };

  // Save Store Identifier/Slug
  const handleSaveIdentifier = async () => {
    if (!activeStoreId) return;
    const clean = slugInput.trim().toLowerCase();
    if (!clean) {
      // Clear identifier
      setSavingIdentifier(true);
      try {
        await updateStoreIdentifier(activeStoreId, null);
        toast.success(t('cloudOnlineStore.identifier.saved'));
        loadStoreDetails();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menghapus URL toko');
      } finally {
        setSavingIdentifier(false);
      }
      return;
    }

    setSavingIdentifier(true);
    try {
      await updateStoreIdentifier(activeStoreId, clean);
      toast.success(t('cloudOnlineStore.identifier.saved'));
      setAvailChecked(null);
      loadStoreDetails();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan URL toko');
    } finally {
      setSavingIdentifier(false);
    }
  };

  // Upload Store Logo
  const handleUploadLogo = async (file: File) => {
    if (!activeStoreId) return;

    const maxSizeBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast.error(t('cloudOnlineStore.logo.tooLarge'));
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('cloudOnlineStore.logo.invalidType'));
      return;
    }

    setUploadingLogo(true);
    try {
      await uploadStoreLogo(activeStoreId, file);
      toast.success(t('cloudOnlineStore.logo.uploadSuccess'));
      loadStoreDetails();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudOnlineStore.logo.uploadFailed'));
    } finally {
      setUploadingLogo(false);
    }
  };

  // Delete Store Logo
  const handleDeleteLogo = async () => {
    if (!activeStoreId) return;

    if (!confirm(t('cloudOnlineStore.logo.deleteConfirm'))) {
      return;
    }

    setUploadingLogo(true);
    try {
      await deleteStoreLogo(activeStoreId);
      toast.success(t('cloudOnlineStore.logo.deleteSuccess'));
      loadStoreDetails();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cloudOnlineStore.logo.deleteFailed'));
    } finally {
      setUploadingLogo(false);
    }
  };

  // Save Store Details
  const handleSaveStoreDetails = async () => {
    if (!activeStoreId) return;
    if (!name.trim()) {
      toast.error('Nama toko tidak boleh kosong.');
      return;
    }
    setSavingDetails(true);

    const activeProvince = provinces.find((p) => String(p.id) === provinceId);
    const activeCity = cities.find((c) => String(c.id) === cityId);
    const activeDistrict = districts.find((d) => String(d.id) === districtId);

    const inputData = {
      name: name.trim(),
      phone: phone.trim() || null,
      address1: address1.trim() || null,
      address2: address2.trim() || null,
      provinceId: provinceId ? Number(provinceId) : null,
      provinceName: activeProvince?.name || null,
      cityId: cityId ? Number(cityId) : null,
      cityName: activeCity?.name || null,
      districtId: districtId ? Number(districtId) : null,
      districtName: activeDistrict?.name || null,
      latitude: latitude,
      longitude: longitude,
      timezone: timezone,
      operationalHours: operationalHours,
    };

    try {
      await updateStoreDetails(activeStoreId, inputData);
      toast.success(t('cloudOnlineStore.details.saved'));
      loadStoreDetails();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui detail toko');
    } finally {
      setSavingDetails(false);
    }
  };

  // Save/Toggle Visibility
  const handleToggleVisibility = async (value: boolean) => {
    if (!activeStoreId) return;

    if (value) {
      // 1. Check if slugInput is unsaved or different
      if (slugInput.trim().toLowerCase() !== (store?.identifier || '')) {
        toast.error(t('cloudOnlineStore.visibility.unsavedIdentifier'));
        return;
      }

      // 2. Check if identifier is empty
      if (!store?.identifier) {
        toast.error(t('cloudOnlineStore.visibility.requiresIdentifier'));
        return;
      }

      // 3. Check for unsaved detail changes
      const hasUnsavedDetails =
        name.trim() !== (store?.name || '').trim() ||
        phone.trim() !== (store?.phone || '').trim() ||
        address1.trim() !== (store?.address1 || '').trim() ||
        address2.trim() !== (store?.address2 || '').trim() ||
        provinceId !== (store?.provinceId ? String(store.provinceId) : '') ||
        cityId !== (store?.cityId ? String(store.cityId) : '') ||
        districtId !== (store?.districtId ? String(store.districtId) : '') ||
        timezone !== (store?.timezone || 'Asia/Jakarta') ||
        latitude !== (store?.latitude ?? null) ||
        longitude !== (store?.longitude ?? null) ||
        JSON.stringify(operationalHours) !== JSON.stringify(store?.operationalHours || {
          monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
        });

      if (hasUnsavedDetails) {
        toast.error(t('cloudOnlineStore.visibility.unsavedDetails'));
        return;
      }

      // 4. Validate all required fields at once
      const missingFields: string[] = [];
      if (!name.trim()) missingFields.push(t('cloudOnlineStore.visibility.fields.name'));
      if (!phone.trim()) missingFields.push(t('cloudOnlineStore.visibility.fields.phone'));
      if (!address1.trim()) missingFields.push(t('cloudOnlineStore.visibility.fields.address'));
      if (!provinceId) missingFields.push(t('cloudOnlineStore.visibility.fields.province'));
      if (!cityId) missingFields.push(t('cloudOnlineStore.visibility.fields.city'));
      if (!districtId) missingFields.push(t('cloudOnlineStore.visibility.fields.district'));
      if (latitude === null || longitude === null) missingFields.push(t('cloudOnlineStore.visibility.fields.coordinates'));

      if (missingFields.length > 0) {
        const fieldsStr = missingFields.join(', ');
        toast.error(t('cloudOnlineStore.visibility.incompleteDetails', { fields: fieldsStr }));
        return;
      }
    }

    setSavingVisibility(true);
    try {
      await updateStoreVisibility(activeStoreId, value);
      setIsPublic(value);
      toast.success('Visibilitas toko berhasil diperbarui.');
      loadStoreDetails();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui visibilitas toko');
    } finally {
      setSavingVisibility(false);
    }
  };

  // Helper inside Operational Hours
  const handleToggleDayOpen = (day: string, checked: boolean) => {
    setOperationalHours((prev) => {
      const next = { ...prev };
      if (checked) {
        next[day] = [{ open: '08:00', close: '17:00' }];
      } else {
        next[day] = [];
      }
      return next;
    });
  };

  const handleAddTimeSlot = (day: string) => {
    setOperationalHours((prev) => {
      const next = { ...prev };
      const currentSlots = next[day] || [];
      next[day] = [...currentSlots, { open: '08:00', close: '17:00' }];
      return next;
    });
  };

  const handleRemoveTimeSlot = (day: string, index: number) => {
    setOperationalHours((prev) => {
      const next = { ...prev };
      const currentSlots = next[day] || [];
      next[day] = currentSlots.filter((_, idx) => idx !== index);
      return next;
    });
  };

  const handleUpdateTimeSlot = (day: string, index: number, field: 'open' | 'close', val: string) => {
    setOperationalHours((prev) => {
      const next = { ...prev };
      const currentSlots = next[day] || [];
      next[day] = currentSlots.map((slot, idx) => (idx === index ? { ...slot, [field]: val } : slot));
      return next;
    });
  };

  if (!can('manage_backup')) {
    return <LockedPage title={t('cloudOnlineStore.title')} permissionLabel="Kelola Backup" />;
  }

  return (
    <div className="px-4 pt-6 pb-20 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/settings/cloud">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          {t('cloudOnlineStore.title')}
        </h1>
      </div>

      {!isLoggedIn || !isSyncSubscribed ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t('cloudAutoBackup.requiresSubscription')}
          </CardContent>
        </Card>
      ) : !activeStoreId ? (
        <Card className="border-0 shadow-sm bg-muted/20 border-dashed border-2">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-warning mx-auto" />
            <p className="text-sm text-muted-foreground max-w-[260px] mx-auto">
              {t('cloudOnlineStore.linkedStoreRequired')}
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs">Memuat informasi toko online…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Section: URL Toko (Identifier) */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="store-identifier" className="text-sm font-semibold">
                  {t('cloudOnlineStore.identifier.label')}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="store-identifier"
                      placeholder={t('cloudOnlineStore.identifier.placeholder')}
                      value={slugInput}
                      onChange={(e) => {
                        setSlugInput(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                        setAvailChecked(null);
                      }}
                      className="h-10 text-sm font-medium"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCheckIdentifier}
                    disabled={checkingAvail || !slugInput}
                    className="h-10 text-xs px-3"
                  >
                    {checkingAvail ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      t('cloudOnlineStore.identifier.checkButton')
                    )}
                  </Button>
                </div>
              </div>

              {/* Status Checking Availability */}
              {availChecked !== null && (
                <p className={`text-xs font-semibold ${availChecked ? 'text-success' : 'text-destructive'}`}>
                  {availChecked ? t('cloudOnlineStore.identifier.available') : t('cloudOnlineStore.identifier.notAvailable')}
                </p>
              )}

              {/* Slug Info */}
              {store?.identifier && (
                <div className="space-y-2">
                  <div className="p-3 bg-primary/5 rounded-xl border border-primary/10 space-y-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-bold block">
                      {t('cloudOnlineStore.identifier.slugInfo')}
                    </span>
                    <a
                      href={`https://market.profitku.my.id/stores/${store.identifier}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline font-bold flex items-center gap-1"
                    >
                      market.profitku.my.id/stores/{store.identifier}
                      <ChevronRight className="w-3 h-3" />
                    </a>
                  </div>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-10 text-xs gap-2 font-semibold border-primary/20 hover:border-primary/40 hover:bg-primary/5"
                      >
                        <QrCode className="w-4 h-4 text-primary" />
                        Cetak / Download QR Code
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md p-6">
                      <DialogHeader className="space-y-1">
                        <DialogTitle className="text-base font-bold flex items-center gap-2">
                          <QrCode className="w-5 h-5 text-primary" />
                          QR Code Toko Online
                        </DialogTitle>
                        <p className="text-xs text-muted-foreground text-left">
                          {hasTemplate 
                            ? 'QR Code telah berhasil digabungkan dengan template cetak Anda.' 
                            : 'Scan QR Code ini untuk langsung membuka halaman toko online Anda di Market Profitku.'
                          }
                        </p>
                      </DialogHeader>
                      <div className="flex flex-col items-center justify-center py-4 bg-muted/30 rounded-2xl border border-dashed border-muted-foreground/20">
                        {hasTemplate && templatedQrUrl ? (
                          <div className="p-1 rounded-xl bg-white shadow-sm border max-w-[240px]">
                            <img src={templatedQrUrl} alt="QR Code Template" className="max-h-72 object-contain" />
                          </div>
                        ) : qrUrl ? (
                          <div className="bg-white p-3 rounded-xl shadow-sm border">
                            <img src={qrUrl} alt="QR Code Toko" className="w-48 h-48" />
                          </div>
                        ) : (
                          <div className="w-48 h-48 flex items-center justify-center text-muted-foreground">
                            <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                        )}
                        <p className="text-xs font-semibold mt-3 text-primary truncate max-w-[280px]">
                          market.profitku.my.id/stores/{store.identifier}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={hasTemplate ? handlePrintTemplatedQR : handlePrintQR}
                          disabled={hasTemplate ? !templatedQrUrl : !qrUrl}
                          className="flex-1 h-10 text-xs gap-1.5"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Cetak QR
                        </Button>
                        <Button
                          type="button"
                          onClick={hasTemplate ? downloadTemplatedQR : handleDownloadQR}
                          disabled={hasTemplate ? !templatedQrUrl : !qrUrl}
                          className="flex-1 h-10 text-xs gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Unduh QR
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}

              <Button
                type="button"
                className="w-full h-10 text-xs"
                onClick={handleSaveIdentifier}
                disabled={savingIdentifier}
              >
                {savingIdentifier ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  t('cloudOnlineStore.identifier.saveButton')
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Section: Visibility Switch */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex-1 space-y-0.5">
                <p className="text-sm font-bold">{t('cloudOnlineStore.visibility.title')}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t('cloudOnlineStore.visibility.description')}
                </p>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={handleToggleVisibility}
                disabled={savingVisibility || !store?.identifier}
              />
            </CardContent>
          </Card>

          {/* Section: Detail Informasi Toko */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-4">
              <p className="text-sm font-bold border-b pb-2 flex items-center gap-1.5">
                <Store className="w-4 h-4 text-primary" />
                {t('cloudOnlineStore.details.title')}
              </p>

              {/* Logo Toko */}
              <div className="flex flex-col items-center gap-3 pb-4 border-b border-dashed">
                <Label className="text-xs text-muted-foreground self-start">
                  {t('cloudOnlineStore.logo.title')}
                </Label>
                <div className="relative group">
                  <div className="w-24 h-24 rounded-2xl border-2 border-border overflow-hidden bg-muted flex items-center justify-center relative shadow-sm">
                    {uploadingLogo ? (
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    ) : store?.logoUrl ? (
                      <img src={store.logoUrl} alt="Store Logo" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
                        <Store className="w-8 h-8 text-muted-foreground/60" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                          {name ? name.substring(0, 2).toUpperCase() : 'FC'}
                        </span>
                      </div>
                    )}
                  </div>
                  <input
                    id="store-logo-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleUploadLogo(file);
                      }
                      e.target.value = '';
                    }}
                    disabled={uploadingLogo}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => document.getElementById('store-logo-input')?.click()}
                    disabled={uploadingLogo}
                  >
                    {store?.logoUrl ? t('cloudOnlineStore.logo.change') : t('cloudOnlineStore.logo.upload')}
                  </Button>
                  {store?.logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 font-semibold"
                      onClick={handleDeleteLogo}
                      disabled={uploadingLogo}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      {t('cloudOnlineStore.logo.delete')}
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug text-center max-w-[200px]">
                  {t('cloudOnlineStore.logo.requirements')}
                </p>
              </div>

              {/* Nama Toko */}
              <div className="space-y-1.5">
                <Label htmlFor="store-name" className="text-xs text-muted-foreground">
                  Nama Toko
                </Label>
                <Input
                  id="store-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              {/* Telepon Toko */}
              <div className="space-y-1.5">
                <Label htmlFor="store-phone" className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {t('cloudOnlineStore.details.phone')}
                </Label>
                <Input
                  id="store-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="h-10 text-sm"
                />
              </div>

              {/* Alamat Lengkap */}
              <div className="space-y-1.5">
                <Label htmlFor="store-address1" className="text-xs text-muted-foreground">
                  {t('cloudOnlineStore.details.address1')}
                </Label>
                <Input
                  id="store-address1"
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  placeholder="Nama jalan, nomor ruko..."
                  className="h-10 text-sm"
                />
              </div>

              {/* Ruko / Lantai */}
              <div className="space-y-1.5">
                <Label htmlFor="store-address2" className="text-xs text-muted-foreground">
                  {t('cloudOnlineStore.details.address2')}
                </Label>
                <Input
                  id="store-address2"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              {/* Wilayah Dropdowns: Provinsi -> Kota -> Kecamatan */}
              <div className="grid grid-cols-1 gap-3">
                {/* Provinsi */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('cloudOnlineStore.details.province')}</Label>
                  <SearchableSelect
                    value={provinceId}
                    onValueChange={(v) => { setProvinceId(v); setCityId(''); setDistrictId(''); }}
                    options={provinces.map((p) => ({ value: String(p.id), label: p.name }))}
                    placeholder="Pilih Provinsi"
                    searchPlaceholder="Cari Provinsi..."
                    loading={loadingProvinces}
                    loadingPlaceholder="Memuat provinsi..."
                  />
                </div>

                {/* Kota */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('cloudOnlineStore.details.city')}</Label>
                  <SearchableSelect
                    value={cityId}
                    onValueChange={(v) => { setCityId(v); setDistrictId(''); }}
                    options={cities.map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="Pilih Kota/Kabupaten"
                    searchPlaceholder="Cari Kota/Kabupaten..."
                    disabled={!provinceId}
                    loading={loadingCities}
                    loadingPlaceholder="Memuat kota/kabupaten..."
                  />
                </div>

                {/* Kecamatan */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('cloudOnlineStore.details.district')}</Label>
                  <SearchableSelect
                    value={districtId}
                    onValueChange={(v) => setDistrictId(v)}
                    options={districts.map((d) => ({ value: String(d.id), label: d.name }))}
                    placeholder="Pilih Kecamatan"
                    searchPlaceholder="Cari Kecamatan..."
                    disabled={!cityId}
                    loading={loadingDistricts}
                    loadingPlaceholder="Memuat kecamatan..."
                  />
                </div>

                {/* Zona Waktu */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t('cloudOnlineStore.details.timezone')}</Label>
                  <SearchableSelect
                    value={timezone}
                    onValueChange={(v) => setTimezone(v)}
                    options={[
                      { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB - UTC+07:00)' },
                      { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA - UTC+08:00)' },
                      { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT - UTC+09:00)' },
                      { value: 'Asia/Kuala_Lumpur', label: 'Asia/Kuala Lumpur (MYT - UTC+08:00)' },
                      { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT - UTC+08:00)' },
                    ]}
                    placeholder="Pilih Zona Waktu"
                    searchPlaceholder="Cari Zona Waktu..."
                  />
                </div>
              </div>

              {/* Map Picker & GPS Section */}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-bold flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5" />
                  {t('cloudOnlineStore.location.title')}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="latitude-input" className="text-[10px] text-muted-foreground">Latitude</Label>
                    <Input
                      id="latitude-input"
                      type="number"
                      value={latitude ?? ''}
                      onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="longitude-input" className="text-[10px] text-muted-foreground">Longitude</Label>
                    <Input
                      id="longitude-input"
                      type="number"
                      value={longitude ?? ''}
                      onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>

                {/* Map Container */}
                <div ref={mapContainerRef} className="h-56 rounded-xl border relative z-10 w-full overflow-hidden" />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {t('cloudOnlineStore.location.dragPin')}
                </p>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGetGPSLocation}
                  disabled={locating}
                  className="w-full h-9 text-xs gap-1.5"
                >
                  {locating ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Navigation className="w-3.5 h-3.5" />
                  )}
                  {locating ? t('cloudOnlineStore.location.gpsLocating') : t('cloudOnlineStore.location.gpsButton')}
                </Button>
              </div>

              {/* Jam Operasional */}
              <div className="space-y-3 pt-4 border-t">
                <p className="text-sm font-bold flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  {t('cloudOnlineStore.operationalHours.title')}
                </p>

                <div className="space-y-3">
                  {DAYS_KEY.map((day) => {
                    const slots = operationalHours[day] || [];
                    const isOpen = slots.length > 0;
                    const localizedDay = t(`cloudOnlineStore.operationalHours.days.${day}`);

                    return (
                      <div key={day} className="p-3 border rounded-xl space-y-2 bg-muted/5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{localizedDay}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                              {isOpen ? t('cloudOnlineStore.operationalHours.open') : t('cloudOnlineStore.operationalHours.closed')}
                            </span>
                            <Switch
                              checked={isOpen}
                              onCheckedChange={(checked) => handleToggleDayOpen(day, checked)}
                            />
                          </div>
                        </div>

                        {isOpen && (
                          <div className="space-y-2 pt-1 border-t border-dashed">
                            {slots.map((slot, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <Input
                                  type="time"
                                  value={slot.open}
                                  onChange={(e) => handleUpdateTimeSlot(day, idx, 'open', e.target.value)}
                                  className="h-8 text-xs p-1 flex-1 text-center"
                                />
                                <span className="text-xs text-muted-foreground">s/d</span>
                                <Input
                                  type="time"
                                  value={slot.close}
                                  onChange={(e) => handleUpdateTimeSlot(day, idx, 'close', e.target.value)}
                                  className="h-8 text-xs p-1 flex-1 text-center"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveTimeSlot(day, idx)}
                                  className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleAddTimeSlot(day)}
                              className="w-full h-8 text-[10px] gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              {t('cloudOnlineStore.operationalHours.addTimeSlot')}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Submit details */}
              <Button
                type="button"
                className="w-full h-11 font-bold text-sm mt-4 gap-1.5"
                onClick={handleSaveStoreDetails}
                disabled={savingDetails}
              >
                {savingDetails ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {t('cloudOnlineStore.details.saveButton')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
