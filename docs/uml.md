# FullyRoute UML diagrams

These diagrams reflect the application as it is implemented today. The backend
is not implemented yet; routing and schedule data are currently handled in the
browser using imported JSON and local storage.

1. [Architecture class diagram](#1-architecture-class-diagram)
2. [Domain class diagram](#2-domain-class-diagram)
3. [Activity diagram: planning a campus route](#3-activity-diagram-planning-a-campus-route)
4. [Use case diagram](#4-use-case-diagram)

## 1. Architecture class diagram

How the React components, routing/schedule modules and data types connect.

```mermaid
classDiagram
  direction LR

  class App["App (React component)"] {
    +startId
    +destId
    +stepFree
    +handleGetRoute()
  }
  class BuildingPicker["BuildingPicker (React component)"]
  class CampusMap["CampusMap (React component)"]
  class AreaMap["AreaMap (React component)"]
  class RouteSteps["RouteSteps (React component)"]
  class InteriorMap["InteriorMap (React component)"]
  class MyClasses["MyClasses (React component)"]
  class NearbyPanel["NearbyPanel (React component)"]
  class SchedulePanel["SchedulePanel (React component)"]
  class GoogleSignInButton["GoogleSignInButton (React component)"]

  App --> BuildingPicker : chooses route endpoints
  App --> CampusMap : displays campus map
  App --> AreaMap : displays nearby map
  App --> RouteSteps : displays campus directions
  App --> InteriorMap : opens building interior
  App --> MyClasses : displays class schedule
  App --> NearbyPanel : displays nearby places
  MyClasses --> SchedulePanel : displays and edits schedule
  MyClasses --> GoogleSignInButton : account sign-in
  MyClasses ..> ScheduleImportModule : imports uploaded files
  MyClasses ..> ScheduleStoreModule : persists schedule and account
  MyClasses ..> GoogleAuthModule : sign-in profile and sign-out
  NearbyPanel ..> AreaRoutingModule : requests nearby routes
  AreaMap ..> AreaRoutingModule : reads map data
  InteriorMap ..> InteriorRoutingModule : requests indoor routes
  RouteSteps ..> RoutingModule : estimates walk time
  CampusMap ..> RoutingModule : draws rounded route

  class Building {
    +string id
    +string code
    +string name
    +BuildingKind kind
    +Position position
    +Provenance provenance
    +string hostId
  }
  class Entrance {
    +string id
    +string buildingId
    +boolean accessible
    +boolean publicAccess
    +string nodeId
    +Position position
    +Provenance provenance
  }
  class Position {
    +PixelPos pixel
    +LatLng geo
  }
  class Provenance {
    +string source
    +string sourceRef
    +boolean verified
    +string notes
  }
  class Graph {
    +PathNode[] nodes
    +PathEdge[] edges
  }
  class PathNode {
    +string id
    +Position position
    +string buildingId
    +Provenance provenance
  }
  class PathEdge {
    +string id
    +string from
    +string to
    +number weightM
    +boolean accessible
    +Provenance provenance
  }
  class RouteRequest {
    +string from
    +string to
    +boolean accessibleOnly
  }
  class RouteResult {
    +string[] path
    +RoutePoint[] points
    +RouteStep[] steps
    +number totalMeters
    +boolean unverified
  }
  class RouteStep {
    +string instruction
    +number distanceM
    +string fromNodeId
    +string toNodeId
  }
  class RoutingModule {
    <<module>>
    +findRoute(from, to, accessibleOnly)
    +placeDoors(buildingId)
    +walkMinutes(meters)
  }
  class AreaRoutingModule {
    <<module>>
    +findAreaRoute(from, to, destName, mode, stepFree)
    +straightLine(from, to)
  }

  Building *-- Position
  Building *-- Provenance
  Building "1" --> "0..*" Entrance : buildingId
  Entrance *-- Position
  Entrance *-- Provenance
  Graph *-- "0..*" PathNode
  Graph *-- "0..*" PathEdge
  PathNode *-- Position
  PathNode *-- Provenance
  PathEdge *-- Provenance
  PathEdge ..> PathNode : from / to IDs
  RouteResult *-- "0..*" RouteStep
  RoutingModule ..> Graph : routes over
  RoutingModule ..> Building : resolves endpoints
  RoutingModule ..> RouteResult : produces
  RouteRequest ..> RoutingModule : input

  class ScheduleFile {
    +string term
    +ScheduleItem[] items
  }
  class ScheduleItem {
    +string id
    +string courseLabel
    +string courseTitle
    +Day[] days
    +string startTime
    +string endTime
    +string locationRaw
    +string buildingId
    +string roomId
    +number confidence
    +boolean confirmed
  }
  class SavedSchedule {
    +string source
    +string fileName
    +string savedAt
    +string term
    +ScheduleItem[] items
  }
  class GoogleProfile {
    +string sub
    +string email
    +string name
  }
  class ScheduleImportModule {
    <<module>>
    +importScheduleFile(file, places)
    +parseIcs(text, places)
    +parseCsv(text, places)
    +parseTitanText(lines, places)
  }
  class ScheduleStoreModule {
    <<module>>
    +loadAccount()
    +saveAccount(account)
    +loadSchedule(account)
    +saveSchedule(account, schedule)
  }
  class GoogleAuthModule {
    <<module>>
    +loadGoogleId()
    +profileFromCredential(credential)
    +signOutGoogle()
  }

  ScheduleFile *-- "0..*" ScheduleItem
  SavedSchedule *-- "0..*" ScheduleItem
  ScheduleItem ..> Building : optional buildingId
  ScheduleImportModule ..> ScheduleItem : creates
  ScheduleImportModule ..> Building : matches locations
  ScheduleStoreModule ..> SavedSchedule : localStorage
  ScheduleStoreModule ..> GoogleProfile : localStorage
  GoogleAuthModule ..> GoogleProfile : creates display profile

  class RegionData {
    +LatLng center
    +RegionWay[] ways
    +number[][] nodes
  }
  class RegionWay {
    +number[] n
    +string hw
    +boolean walk
    +boolean drive
    +boolean steps
    +number mps
  }
  class AreaTrip {
    +TravelMode mode
    +boolean stepFree
    +LatLng[] points
    +number meters
    +number seconds
    +AreaStep[] steps
  }
  class AreaStep {
    +string instruction
    +number distanceM
  }
  RegionData *-- "0..*" RegionWay
  AreaRoutingModule ..> RegionData : routes over
  AreaRoutingModule ..> Building : nearby places
  AreaRoutingModule ..> AreaTrip : produces
  AreaTrip *-- "0..*" AreaStep

  class Interior {
    +string buildingId
    +string code
    +string name
    +InteriorFloor[] floors
    +VerticalCore[] cores
    +InteriorEntrance[] entrances
  }
  class InteriorFloor {
    +string id
    +number level
    +string name
    +InteriorRoom[] rooms
    +PlanPoint[][] corridors
  }
  class InteriorRoom {
    +string id
    +string number
    +string name
    +RoomType type
    +PlanPoint[] poly
    +PlanPoint door
  }
  class VerticalCore {
    +string id
    +string type
    +string name
    +PlanPoint point
    +string[] floors
  }
  class InteriorEntrance {
    +string entranceId
    +string name
    +string floorId
    +PlanPoint point
  }
  class IndoorRoute {
    +IndoorLeg[] legs
    +IndoorStep[] steps
    +number meters
    +string entranceId
    +transfers
  }
  class InteriorRoutingModule {
    <<module>>
    +findRoom(interior, roomId)
    +findIndoorRoute(interior, roomId, options)
  }

  Interior *-- "1..*" InteriorFloor
  Interior *-- "0..*" VerticalCore
  Interior *-- "0..*" InteriorEntrance
  InteriorFloor *-- "0..*" InteriorRoom
  InteriorRoutingModule ..> Interior : builds indoor graph
  InteriorRoutingModule ..> IndoorRoute : produces
  InteriorRoutingModule ..> Entrance : checks accessibility
```

## 2. Domain class diagram

A focused view of the core campus-routing and schedule classes using full
class-diagram notation:

- **Class boxes** have three compartments: name, attributes and operations.
- **Visibility:** `+` public and `-` private (`#` protected and `~` package
  are not needed by these modules).
- **Attributes** are written as `name : type`; **operations** list their
  parameters and return type.
- **Relationships:** composition (filled diamond), aggregation (hollow
  diamond), association (solid line), generalization (hollow triangle) and
  dependency (dashed arrow). Multiplicities such as `1`, `0..1` and `0..*`
  are shown on association ends.

```mermaid
classDiagram
  direction TB

  class BuildingKind {
    <<enumeration>>
    academic
    service
    housing
    athletics
    landmark
    parking
    poi
  }
  class TravelMode {
    <<enumeration>>
    walk
    drive
  }

  class Building {
    +id : string
    +code : string
    +name : string
    +kind : BuildingKind
    +position : Position
    +hostId : string
  }
  class Entrance {
    +id : string
    +buildingId : string
    +accessible : boolean
    +publicAccess : boolean
    +nodeId : string
  }
  class Position {
    +pixel : PixelPos
    +geo : LatLng
  }
  class Graph {
    +nodes : PathNode[]
    +edges : PathEdge[]
  }
  class PathNode {
    +id : string
    +buildingId : string
  }
  class PathEdge {
    +id : string
    +from : string
    +to : string
    +weightM : number
    +accessible : boolean
  }

  class RoutingModule {
    <<module>>
    -graph : Graph
    -buildings : Building[]
    +findRoute(from : string, to : string, accessibleOnly : boolean) RouteOutcome
    +walkMinutes(meters : number) number
  }
  class RouteOutcome {
    <<abstract>>
    +ok : boolean
  }
  class RouteSuccess {
    +route : RouteResult
  }
  class RouteFailure {
    +reason : string
    +place : string
  }
  class RouteResult {
    +path : string[]
    +totalMeters : number
    +unverified : boolean
    +steps : RouteStep[]
  }
  class RouteStep {
    +instruction : string
    +distanceM : number
  }

  class Interior {
    +buildingId : string
    +name : string
    +floors : InteriorFloor[]
  }
  class InteriorFloor {
    +id : string
    +level : number
    +rooms : InteriorRoom[]
  }
  class InteriorRoom {
    +id : string
    +number : string
    +type : RoomType
  }
  class InteriorRoutingModule {
    <<module>>
    +findRoom(interior : Interior, roomId : string) InteriorRoom
    +findIndoorRoute(interior : Interior, roomId : string, options : object) IndoorRoute
  }

  class AreaRoutingModule {
    <<module>>
    +findAreaRoute(from : LatLng, to : LatLng, destName : string, mode : TravelMode, stepFree : boolean) AreaOutcome
    +straightLine(from : LatLng, to : LatLng) object
  }

  class GoogleProfile {
    +sub : string
    +email : string
    +name : string
  }
  class SavedSchedule {
    +source : string
    +fileName : string
    +savedAt : string
    +term : string
    +items : ScheduleItem[]
  }
  class ScheduleItem {
    +id : string
    +courseLabel : string
    +days : Day[]
    +startTime : string
    +endTime : string
    +buildingId : string
    +roomId : string
    +confidence : number
  }
  class ScheduleImportModule {
    <<module>>
    +importScheduleFile(file : File, places : Building[]) ImportedSchedule
    +parseIcs(text : string, places : Building[]) ImportedSchedule
    +parseCsv(text : string, places : Building[]) ImportedSchedule
    +parseTitanText(lines : string[], places : Building[]) ImportedSchedule
  }
  class ScheduleStoreModule {
    <<module>>
    +loadAccount() GoogleProfile
    +saveAccount(account : GoogleProfile) void
    +loadSchedule(account : GoogleProfile) SavedSchedule
    +saveSchedule(account : GoogleProfile, schedule : SavedSchedule) void
  }

  Building --> BuildingKind
  Building *-- "1" Position : composition
  Building "1" -- "0..*" Entrance : has doors
  Building "0..1" -- "0..1" Interior : floor plans
  Entrance "0..*" --> "1" PathNode : joins walkway at
  Graph *-- "1..*" PathNode : composition
  Graph *-- "0..*" PathEdge : composition
  PathEdge "0..*" --> "2" PathNode : connects

  RoutingModule o-- "1" Graph : aggregation
  RoutingModule o-- "0..*" Building : aggregation
  RoutingModule ..> RouteOutcome : creates
  RouteOutcome <|-- RouteSuccess : generalization
  RouteOutcome <|-- RouteFailure : generalization
  RouteSuccess *-- "1" RouteResult
  RouteResult *-- "1..*" RouteStep

  Interior *-- "1..*" InteriorFloor
  InteriorFloor *-- "0..*" InteriorRoom
  InteriorRoutingModule ..> Interior : routes inside
  InteriorRoutingModule ..> Entrance : checks accessibility

  AreaRoutingModule ..> TravelMode : uses
  AreaRoutingModule ..> Building : nearby places

  GoogleProfile "0..1" -- "0..1" SavedSchedule : owns
  SavedSchedule *-- "0..*" ScheduleItem
  ScheduleItem "0..*" --> "0..1" Building : held in
  ScheduleImportModule ..> ScheduleItem : creates
  ScheduleStoreModule ..> SavedSchedule : localStorage
  ScheduleStoreModule ..> GoogleProfile : localStorage
```

`RouteOutcome` is a TypeScript discriminated union in code
(`{ ok: true, route }` or `{ ok: false, reason, place? }`); it is drawn as an
abstract parent with two subclasses to show that relationship as a
generalization.

## 3. Activity diagram: planning a campus route

The workflow from opening FullyRoute to following a route, split into
**swimlanes** for the student, the React UI and the routing modules. Notation:

- **Initial node** (filled circle) and **final node** (circled dot).
- **Action nodes** (rounded rectangles) for each step.
- **Decision / merge nodes** (diamonds) with **guard conditions** in `[ ]`.
- **Fork / join bars** (thick black bars) for work that happens in parallel.

```mermaid
flowchart TB
  start((" ")):::initial

  subgraph Student["Student"]
    direction TB
    openApp(["Open FullyRoute"])
    pick(["Pick start and destination<br/>(dropdown or map click)"])
    toggle(["Set step-free option"])
    getRoute(["Click Get Route"])
    turnOff(["Turn off step-free"])
    wantIndoor{" "}
    pickRoom(["Choose a room on<br/>the indoor map"])
    wantShare{" "}
    copyLink(["Copy route link"])
  end

  subgraph UI["FullyRoute UI (App)"]
    direction TB
    sharedLink{" "}
    restore(["Restore start, destination<br/>and step-free from URL"])
    sameCheck{" "}
    warnSame(["Ask for a different<br/>destination"])
    fork1[" "]:::bar
    drawMap(["Draw route on<br/>campus map"])
    listSteps(["List directions<br/>and walk time"])
    syncUrl(["Update shareable URL"])
    join1[" "]:::bar
    showFail(["Show reason the<br/>route failed"])
    offerOff{" "}
    showIndoor(["Show indoor route<br/>from arrival door"])
  end

  subgraph Routing["Routing modules"]
    direction TB
    fork2[" "]:::bar
    startDoors(["Resolve start doors"])
    endDoors(["Resolve destination doors"])
    join2[" "]:::bar
    dijkstra(["Find shortest path<br/>on walkway graph"])
    found{" "}
    indoorRoute(["findIndoorRoute()"])
  end

  done(((" "))):::final

  start --> openApp --> sharedLink
  sharedLink -- "[shared link]" --> restore --> fork2
  sharedLink -- "[no shared link]" --> pick --> sameCheck
  sameCheck -- "[same building]" --> warnSame --> pick
  sameCheck -- "[different buildings]" --> toggle --> getRoute --> fork2
  fork2 --> startDoors --> join2
  fork2 --> endDoors --> join2
  join2 --> dijkstra --> found
  found -- "[no path / no accessible door]" --> showFail --> offerOff
  offerOff -- "[step-free on]" --> turnOff --> fork2
  offerOff -- "[step-free off]" --> done
  found -- "[route found]" --> fork1
  fork1 --> drawMap --> join1
  fork1 --> listSteps --> join1
  fork1 --> syncUrl --> join1
  join1 --> wantIndoor
  wantIndoor -- "[destination has floor plans]" --> pickRoom --> indoorRoute --> showIndoor --> wantShare
  wantIndoor -- "[outdoor only]" --> wantShare
  wantShare -- "[share]" --> copyLink --> done
  wantShare -- "[no share]" --> done

  classDef initial fill:#000,stroke:#000,color:#000
  classDef final fill:#000,stroke:#000,stroke-width:4px,color:#000
  classDef bar fill:#000,stroke:#000,color:#000
```

## 4. Use case diagram

What each actor can do with FullyRoute. Notation:

- **Actors** sit outside the **system boundary** (the FullyRoute box).
  _Student_ and _Campus Visitor_ specialize the general _User_ actor
  (generalization). _Google Identity Services_ is a secondary, external actor.
- **Use cases** are ovals inside the boundary; solid lines are associations
  between actors and the use cases they take part in.
- **«include»** points to behavior that always runs as part of the base use
  case. **«extend»** points from optional behavior back to the use case it
  extends.

```mermaid
flowchart LR
  user["🧍<br/>User"]:::actor
  student["🧍<br/>Student"]:::actor
  visitor["🧍<br/>Campus Visitor"]:::actor
  google["🖥️<br/>«system»<br/>Google Identity Services"]:::actor

  student -- generalization --> user
  visitor -- generalization --> user

  subgraph FullyRoute["FullyRoute"]
    direction TB
    planRoute(["Plan campus route"])
    selectPlaces(["Select start and destination"])
    computeRoute(["Compute walking route"])
    viewSteps(["View directions and walk time"])
    stepFree(["Request step-free route"])
    swap(["Swap start and destination"])
    shareRoute(["Share route link"])
    openShared(["Open shared route link"])
    indoor(["View indoor route to a room"])
    nearby(["Find nearby places"])
    trip(["Get walk or drive trip"])
    importSched(["Import class schedule"])
    matchRooms(["Match class locations to buildings"])
    sample(["Load sample schedule"])
    routeClass(["Route to a class"])
    signIn(["Sign in with Google"])
    signOut(["Sign out"])
    removeSched(["Remove saved schedule"])
  end

  user --- planRoute
  user --- openShared
  user --- nearby
  user --- indoor
  student --- importSched
  student --- sample
  student --- routeClass
  student --- signIn
  student --- signOut
  student --- removeSched
  signIn --- google

  planRoute -. "«include»" .-> selectPlaces
  planRoute -. "«include»" .-> computeRoute
  planRoute -. "«include»" .-> viewSteps
  stepFree -. "«extend»" .-> planRoute
  swap -. "«extend»" .-> planRoute
  shareRoute -. "«extend»" .-> planRoute
  indoor -. "«extend»" .-> planRoute
  openShared -. "«include»" .-> computeRoute
  trip -. "«extend»" .-> nearby
  importSched -. "«include»" .-> matchRooms
  routeClass -. "«include»" .-> planRoute

  classDef actor fill:none,stroke:none
```

All four diagrams are written in Mermaid so they can be reviewed and updated
as the program changes. They render in GitHub and in VS Code's Markdown
preview (with Mermaid support).
