# Eonet

A lightweight tool that lets people see natural events (wildfires, storms, volcanoes, …) near a location, backed by a local mirror of NASA's EONET catalogue.

## Language

### Events

**Event**:
A single natural occurrence curated by EONET, such as one wildfire or one storm, identified by its EONET id.
_Avoid_: Incident, disaster, alert

**Category**:
The kind of natural phenomenon an Event belongs to, as defined by EONET (e.g. Wildfires, Severe Storms). An Event may have more than one.
_Avoid_: Type, kind

**Source**:
An external organisation or feed that reported an Event and links to more information about it.
_Avoid_: Provider, origin

**Geometry**:
One dated location of an Event: a point or polygon paired with a timestamp, optionally carrying a Magnitude.
_Avoid_: Position, coordinate, observation

**Track**:
All Geometries of an Event, ordered by date.
_Avoid_: Path, history

**Latest Position**:
The location of an Event's most recent Geometry; the centroid when that Geometry is a polygon.
_Avoid_: Current location

**Magnitude**:
A measured size or intensity attached to a Geometry, with its unit (e.g. acres burned, wind speed).
_Avoid_: Severity, size

### Status

**Open / Closed**:
EONET's own lifecycle flag for an Event. Closed Events carry the date EONET declared them ended. Open does not imply the Event is still happening.

**Active Event**:
An Open Event whose most recent Geometry falls within the Activity Window.
_Avoid_: Live event, current event, ongoing event

**Activity Window**:
The number of days back from now within which an Event's latest Geometry must fall for it to count as Active.

### Location

**Search Point**:
The location the user is asking about, taken from their device or placed by hand on the map.
_Avoid_: My location, home, area

**Radius**:
The distance from the Search Point within which an Event's Latest Position must lie to be considered nearby.

**Coverage**:
The parts of the world where EONET actually reports Events. An empty result means "no EONET Events nearby", never "no danger".

### Data mirror

**Event History**:
Every Event ever mirrored, including Closed ones, with its full Track. Earlier values of a changed field are not kept.
_Avoid_: Snapshot, archive, change log

**Incremental Sync**:
The frequent pull of only recently updated Events from EONET.

**Full Sync**:
The periodic pull of all Open Events plus recently Closed ones, which reconciles the mirror and records closures.
_Avoid_: Reconcile, refresh

**Backfill**:
The one-time import of EONET's historical Events into the mirror.
_Avoid_: Seed, migration
