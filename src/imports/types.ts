// Shared types for the campus navigation MVP.
// JSON files in /mock match these shapes exactly. Field names are camelCase;
// the FastAPI backend should expose the same names (e.g. via pydantic aliases).

export type PixelPos = { x: number; y: number }; // pixel space of map.json's image
export type LatLng = { lat: number; lng: number };

// Use `pixel` (map space) or `geo` (GPS); routing converts `geo` via geo.ts.
export type Position = { pixel?: PixelPos; geo?: LatLng };

export type Provenance = {
  source: "map-image" | "emergency-plan" | "manual" | "survey" | "imported";
  sourceRef?: string;
  verified: boolean; // true only after a human has confirmed it in person
  notes?: string;
};

export type BuildingKind =
  | "academic"
  | "service"
  | "housing"
  | "athletics"
  | "landmark"
  | "parking"
  | "poi"; // bus stop, dining, restroom, bike rack, charger…

export type PoiType =
  | "dining"
  | "restroom"
  | "transit"
  | "bike"
  | "ev"
  | "atm"
  | "grocery"
  | "pharmacy"
  | "health"
  | "bank"
  | "fuel"
  | "shopping"
  | "library"
  | "post"
  | "park"
  | "fitness"
  | "other";

export type Building = {
  id: string; // stable and unique, e.g. "bldg-cs". ALWAYS key by id.
  code: string | null; // display only, NOT unique (two lots are both "E1"); null for landmarks
  name: string;
  kind: BuildingKind;
  position: Position; // empty object when the location is unknown
  provenance: Provenance;
  poiType?: PoiType; // only for kind "poi"
  hostId?: string; // POI inside another place — routes use the host's doors
};

export type Entrance = {
  id: string;
  buildingId: string;
  name: string;
  accessible: boolean | null; // null = unknown
  publicAccess: boolean;
  nodeId: string | null; // graph node it joins, if any (routing snaps to walkways)
  floorId: string | null; // null until the indoor phase
  position: Position;
  provenance: Provenance;
};

export type PathNode = {
  id: string;
  position: Position;
  buildingId: string | null; // building or landmark this node belongs to, if any
  provenance: Provenance;
};

// Edges are UNDIRECTED. Routing must use weightM only, never pixel distance.
export type PathEdge = {
  id: string;
  from: string;
  to: string;
  weightM: number; // estimated meters
  accessible: boolean;
  provenance: Provenance;
};

export type Graph = { nodes: PathNode[]; edges: PathEdge[] };

export type MapMeta = {
  image: string;
  width: number;
  height: number;
  revision: string;
  note: string;
  north: "up";
};

// ---- Schedule (mocked screen only in the MVP) ----

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type ScheduleItem = {
  id: string;
  courseLabel: string; // "CPSC 362"
  courseTitle: string;
  section: string;
  classNbr: string;
  component: string; // "Lecture", "Lab", "Discussion"
  startDate: string; // ISO date
  endDate: string;
  days: Day[];
  startTime: string | null; // "HH:MM" 24h
  endTime: string | null;
  locationRaw: string; // exactly as printed on the source, never edited
  buildingCode: string | null;
  roomNumber: string | null; // ALWAYS a string ("063" must keep its leading zero)
  roomDesc: string | null;
  buildingId: string | null; // null = online/TBA or unresolved
  roomId: string | null; // null until the indoor phase
  confidence: number; // 0..1 parser confidence
  confirmed: boolean; // false = needs the student's review
};

export type ScheduleFile = {
  user: { id: string; displayName: string; role: "student" | "guest_account" | "admin" };
  term: string;
  items: ScheduleItem[];
};

// ---- API contract (backend later; frontend uses local mock until then) ----

export type RouteRequest = {
  from: string; // building id
  to: string; // building id
  accessibleOnly: boolean;
};

export type RouteStep = {
  instruction: string; // e.g. "Head east along Titan Walk"
  distanceM: number;
  fromNodeId: string;
  toNodeId: string;
};

export type RouteResult = {
  steps: RouteStep[];
  totalMeters: number;
  path: string[]; // ordered node ids
  unverified: boolean; // true if any node or edge on the path is unverified
};

export type TravelMode = "walk" | "drive";

// GET /places?near=lat,lng&radiusM=3219&types=dining,grocery
export type NearbyRequest = { near: LatLng; radiusM: number; poiTypes?: PoiType[] };

// Off-campus trip between two GPS points.
export type AreaRouteRequest = { from: LatLng; to: LatLng; mode: TravelMode; stepFree: boolean };

// --- Nearby area (off campus) ------------------------------------------------
// region.json: OpenStreetMap streets and paths around campus, imported by
// scripts/import-osm.mjs. nearby.json holds the places as Building records
// (kind "poi", geo position only, ids "near-<osm type><osm id>").
export type RegionWay = {
  n: number[]; // indexes into RegionData.nodes, in drawing order
  hw: string; // OSM highway class ("residential", "footway"…), or "sidewalk" / "crossing" for those footways
  name?: string;
  along?: string; // unnamed sidewalk: the street it runs beside (inferred at import)
  walk: boolean;
  drive: boolean;
  oneway?: 1 | -1; // driving direction relative to `n`; absent = both ways
  steps?: boolean; // stairs, avoided when step-free
  mps?: number; // driving speed in meters per second
};

export type RegionData = {
  source: string;
  license: string;
  attribution: string;
  fetchedAt: string; // ISO timestamp of the import
  center: LatLng;
  radiusM: number; // places are within this distance of `center`
  roadRadiusM: number; // streets extend a bit farther so edge places stay reachable
  campus: [number, number][]; // campus boundary ring, [lat, lng]
  nodes: [number, number][]; // [lat, lng]
  ways: RegionWay[];
};

// --- Interiors ---------------------------------------------------------------
// Floor-plan space is meters, origin at the footprint's top-left, y pointing
// down (same orientation as the campus map). `origin` maps it back to map px.
export type PlanPoint = [number, number];

export type RoomType =
  | "classroom"
  | "lab"
  | "office"
  | "restroom"
  | "lounge"
  | "service"
  | "lobby"
  | "room"; // unlabelled on the source plan

export type InteriorRoom = {
  id: string;
  number: string; // as signed, e.g. "CS-104"
  name: string;
  type: RoomType;
  poly: PlanPoint[];
  door: PlanPoint; // where the room opens onto a corridor
};

export type InteriorFloor = {
  id: string;
  level: number;
  name: string;
  // Optional real floor-plan image, stretched over `bounds` (plan meters).
  // When present, rooms draw as transparent hit areas over the image.
  plan?: { image: string; bounds: [PlanPoint, PlanPoint] };
  rooms: InteriorRoom[];
  corridors: PlanPoint[][]; // walkable centerlines
  outline?: PlanPoint[][]; // this floor's shell, when it differs from the building's
  sourcePhoto?: string; // path under src/imports of the sign/plan it was transcribed from
};

export type VerticalCore = {
  id: string;
  type: "stairs" | "elevator";
  name: string;
  point: PlanPoint;
  floors: string[]; // floor ids it serves
};

export type InteriorEntrance = {
  entranceId: string; // id in entrances.json
  name: string;
  floorId: string;
  point: PlanPoint;
};

export type Interior = {
  buildingId: string;
  code: string;
  name: string;
  origin: { x: number; y: number; metersPerPixel: number };
  outline: PlanPoint[][];
  floors: InteriorFloor[];
  cores: VerticalCore[];
  entrances: InteriorEntrance[];
  provenance: Provenance;
};
