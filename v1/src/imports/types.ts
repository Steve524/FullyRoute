// Shared types for the campus navigation MVP.
// JSON files in /mock match these shapes exactly. Field names are camelCase;
// the FastAPI backend should expose the same names (e.g. via pydantic aliases).

export type PixelPos = { x: number; y: number }; // pixel space of map.json's image
export type LatLng = { lat: number; lng: number };

// MVP populates `pixel` only. `geo` is reserved for the real-coordinates phase.
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
  | "parking"; // parking is never a navigation destination in the MVP

export type Building = {
  id: string; // stable and unique, e.g. "bldg-cs". ALWAYS key by id.
  code: string | null; // display only, NOT unique (two lots are both "E1"); null for landmarks
  name: string;
  kind: BuildingKind;
  position: Position; // empty object when the location is unknown
  provenance: Provenance;
};

export type Entrance = {
  id: string;
  buildingId: string;
  name: string;
  accessible: boolean | null; // null = unknown
  publicAccess: boolean;
  nodeId: string; // where this entrance joins the routing graph
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
