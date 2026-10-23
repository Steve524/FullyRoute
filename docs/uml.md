# FullyRoute UML class diagram

This diagram reflects the application as it is implemented today. The backend
is not implemented yet; routing and schedule data are currently handled in the
browser using imported JSON and local storage.

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

The diagram is written in Mermaid so it can be reviewed and updated as the
program changes.
