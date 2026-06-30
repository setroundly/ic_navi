export type LatLng = {
  lat: number;
  lng: number;
};

export type GeocodeResult = LatLng & {
  address: string;
};

export type IcType = "IC" | "JCT" | "SA_PA" | "SIC";

export type IcRecord = {
  id: string;
  name: string;
  nameDisplay: string;
  ref: string | null;
  icType: IcType;
  lat: number;
  lng: number;
};

export type IcCandidate = {
  id: string;
  name: string;
  nameDisplay: string;
  icType: IcType;
  distanceM: number;
};

export type RouteSearchResult = {
  origin: GeocodeResult;
  destination: GeocodeResult;
  entryIc: IcCandidate;
  exitIc: IcCandidate;
  entryCandidates: IcCandidate[];
  exitCandidates: IcCandidate[];
  distanceKm: number;
  durationMin: number;
  highwayDistanceKm: number | null;
  localDistanceKm: number | null;
};
