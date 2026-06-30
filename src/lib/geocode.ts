import type { GeocodeResult } from "@/types/route";

type GsiFeature = {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    title?: string;
  };
};

type HeartRailsLocation = {
  prefecture?: string;
  city?: string;
  town?: string;
  x: string;
  y: string;
};

type NominatimResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

type HeartRailsStation = {
  name?: string;
  prefecture?: string;
  line?: string;
  x: string;
  y: string;
};

const KANTO_PREFECTURES = new Set([
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
]);

const FETCH_HEADERS = { "User-Agent": "ic-navi/1.0" };

function looksLikeAddress(query: string): boolean {
  return /[都道府県]|市|区|町|村|丁目|\d/.test(query);
}

function looksLikeStation(query: string): boolean {
  return /駅$/.test(query);
}

function shortenDisplayName(displayName: string): string {
  const first = displayName.split(",")[0]?.trim();
  return first || displayName;
}

function pickKantoStation(
  stations: HeartRailsStation[],
): HeartRailsStation | null {
  const kantoStation = stations.find((station) =>
    KANTO_PREFECTURES.has(station.prefecture ?? ""),
  );
  return kantoStation ?? stations[0] ?? null;
}

async function geocodeWithGsi(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://msearch.gsi.go.jp/address-search/AddressSearch");
  url.searchParams.set("q", address);

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as GsiFeature[];
  const first = data[0];
  const coords = first?.geometry?.coordinates;

  if (!coords) return null;

  const [lng, lat] = coords;
  return {
    address: first.properties?.title ?? address,
    lat,
    lng,
  };
}

async function geocodeWithHeartRails(
  address: string,
): Promise<GeocodeResult | null> {
  const url = new URL("https://geoapi.heartrails.com/api/json");
  url.searchParams.set("method", "suggest");
  url.searchParams.set("matching", "like");
  url.searchParams.set("keyword", address);

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    response?: { location?: HeartRailsLocation[] };
  };

  const location = data.response?.location?.[0];
  if (!location) return null;

  const lng = Number(location.x);
  const lat = Number(location.y);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const resolvedAddress = [
    location.prefecture,
    location.city,
    location.town,
  ]
    .filter(Boolean)
    .join("");

  return {
    address: resolvedAddress || address,
    lat,
    lng,
  };
}

async function geocodeWithNominatim(
  query: string,
): Promise<GeocodeResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "ja");

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as NominatimResult[];
  const first = data[0];
  if (!first?.lat || !first.lon) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return {
    address: first.display_name
      ? shortenDisplayName(first.display_name)
      : query,
    lat,
    lng,
  };
}

async function geocodeWithStation(
  query: string,
): Promise<GeocodeResult | null> {
  const stationName = query.replace(/駅$/, "");
  const url = new URL("https://express.heartrails.com/api/json");
  url.searchParams.set("method", "getStations");
  url.searchParams.set("name", stationName);

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    response?: { station?: HeartRailsStation | HeartRailsStation[] };
  };

  const stations = data.response?.station;
  if (!stations) return null;

  const stationList = Array.isArray(stations) ? stations : [stations];
  const station = pickKantoStation(stationList);
  if (!station) return null;

  const lat = Number(station.y);
  const lng = Number(station.x);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const label = [
    station.prefecture,
    station.line,
    station.name ? `${station.name}駅` : stationName,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    address: label || query,
    lat,
    lng,
  };
}

function pickGeocoders(
  query: string,
): Array<(value: string) => Promise<GeocodeResult | null>> {
  if (looksLikeStation(query)) {
    return [
      geocodeWithStation,
      geocodeWithNominatim,
      geocodeWithHeartRails,
      geocodeWithGsi,
    ];
  }

  if (looksLikeAddress(query)) {
    return [
      geocodeWithGsi,
      geocodeWithHeartRails,
      geocodeWithNominatim,
      geocodeWithStation,
    ];
  }

  return [
    geocodeWithStation,
    geocodeWithNominatim,
    geocodeWithHeartRails,
    geocodeWithGsi,
  ];
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("場所を入力してください");
  }

  for (const geocoder of pickGeocoders(trimmed)) {
    const result = await geocoder(trimmed);
    if (result) return result;
  }

  throw new Error(`場所が見つかりませんでした: ${trimmed}`);
}
