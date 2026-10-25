-- Mirror of NASA EONET v3 plus the public read API.
-- The read functions are the API contract (ADR 0002): the anonymous role may execute them and nothing else.

create extension if not exists postgis with schema extensions;

-- Tables ---------------------------------------------------------------------

create table public.events (
  id text primary key,
  title text not null,
  description text,
  link text not null,
  closed_at timestamptz,
  categories text[] not null,
  sources jsonb not null default '[]',
  latest_position extensions.geography not null,
  latest_date timestamptz not null
);

create index events_categories_idx on public.events using gin (categories);
create index events_latest_position_idx on public.events using gist (latest_position);

create table public.event_geometries (
  id bigint generated always as identity primary key,
  event_id text not null references public.events (id) on delete cascade,
  date timestamptz not null,
  geom extensions.geography not null,
  magnitude_value double precision,
  magnitude_unit text
);

create index event_geometries_event_id_date_idx on public.event_geometries (event_id, date);

create type public.sync_kind as enum ('incremental', 'full', 'backfill');

create table public.sync_runs (
  id bigint generated always as identity primary key,
  kind public.sync_kind not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  events_received integer,
  events_inserted integer,
  error text
);

create index sync_runs_kind_finished_at_idx on public.sync_runs (kind, finished_at desc)
  where error is null;

alter table public.events enable row level security;
alter table public.event_geometries enable row level security;
alter table public.sync_runs enable row level security;

-- Writes (service role only) -------------------------------------------------

-- Upserts validated EONET v3 events. Each event's geometries are replaced in the same
-- transaction, so the stored Track always matches EONET's. Events are never deleted.
create function public.upsert_events(payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  received integer;
  inserted integer;
begin
  -- Serialises concurrent Incremental/Full Syncs and Backfill so they cannot deadlock.
  perform pg_advisory_xact_lock(hashtext('public.upsert_events'));

  create temporary table incoming_geometries on commit drop as
  select
    e.value ->> 'id' as event_id,
    g.ordinality as position,
    (g.value ->> 'date')::timestamptz as date,
    extensions.st_geomfromgeojson(
      jsonb_build_object('type', g.value ->> 'type', 'coordinates', g.value -> 'coordinates')
    )::extensions.geography as geom,
    (g.value ->> 'magnitudeValue')::double precision as magnitude_value,
    g.value ->> 'magnitudeUnit' as magnitude_unit
  from jsonb_array_elements(payload) as e
  cross join lateral jsonb_array_elements(e.value -> 'geometry') with ordinality as g;

  with latest as (
    select distinct on (event_id) event_id, date, geom
    from incoming_geometries
    order by event_id, date desc, position desc
  ),
  upserted as (
    insert into public.events as target (
      id, title, description, link, closed_at, categories, sources, latest_position, latest_date
    )
    select
      e.value ->> 'id',
      e.value ->> 'title',
      e.value ->> 'description',
      e.value ->> 'link',
      (e.value ->> 'closed')::timestamptz,
      array(select c ->> 'id' from jsonb_array_elements(e.value -> 'categories') as c),
      coalesce(e.value -> 'sources', '[]'),
      extensions.st_centroid(latest.geom::extensions.geometry)::extensions.geography,
      latest.date
    from jsonb_array_elements(payload) as e
    join latest on latest.event_id = e.value ->> 'id'
    order by 1
    on conflict (id) do update set
      title = excluded.title,
      description = excluded.description,
      link = excluded.link,
      closed_at = excluded.closed_at,
      categories = excluded.categories,
      sources = excluded.sources,
      latest_position = excluded.latest_position,
      latest_date = excluded.latest_date
    returning (xmax = 0) as is_insert
  )
  select count(*), count(*) filter (where is_insert) into received, inserted from upserted;

  delete from public.event_geometries
  where event_id in (select distinct event_id from incoming_geometries);

  insert into public.event_geometries (event_id, date, geom, magnitude_value, magnitude_unit)
  select event_id, date, geom, magnitude_value, magnitude_unit
  from incoming_geometries
  order by event_id, date, position;

  return jsonb_build_object('received', received, 'inserted', inserted);
end;
$$;

-- Read API -------------------------------------------------------------------

create type public.nearby_event as (
  id text,
  title text,
  categories text[],
  latitude double precision,
  longitude double precision,
  latest_date timestamptz,
  magnitude_value double precision,
  magnitude_unit text,
  distance_km double precision
);

create function public.events_near(
  lat double precision,
  lon double precision,
  radius_km double precision,
  categories text[] default null,
  activity_window_days integer default 30
)
returns setof public.nearby_event
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_point extensions.geography;
begin
  if lat is null or lat not between -90 and 90 or lon is null or lon not between -180 and 180 then
    raise exception 'lat must be within [-90, 90] and lon within [-180, 180]'
      using errcode = '22023';
  end if;
  if radius_km is null or radius_km <= 0 or radius_km > 500 then
    raise exception 'radius_km must be greater than 0 and at most 500' using errcode = '22023';
  end if;
  if activity_window_days is null or activity_window_days < 1 or activity_window_days > 365 then
    raise exception 'activity_window_days must be between 1 and 365' using errcode = '22023';
  end if;

  search_point := extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography;

  return query
  select
    e.id,
    e.title,
    e.categories,
    extensions.st_y(e.latest_position::extensions.geometry),
    extensions.st_x(e.latest_position::extensions.geometry),
    e.latest_date,
    latest.magnitude_value,
    latest.magnitude_unit,
    extensions.st_distance(e.latest_position, search_point) / 1000
  from public.events as e
  left join lateral (
    select g.magnitude_value, g.magnitude_unit
    from public.event_geometries as g
    where g.event_id = e.id
    order by g.date desc, g.id desc
    limit 1
  ) as latest on true
  where e.closed_at is null
    and e.latest_date >= now() - make_interval(days => activity_window_days)
    and extensions.st_dwithin(e.latest_position, search_point, radius_km * 1000)
    and (events_near.categories is null or e.categories && events_near.categories)
  order by 9, e.id
  limit 500;
end;
$$;

create function public.event_detail(id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'description', e.description,
    'link', e.link,
    'closed_at', e.closed_at,
    'categories', e.categories,
    'sources', e.sources,
    'latitude', extensions.st_y(e.latest_position::extensions.geometry),
    'longitude', extensions.st_x(e.latest_position::extensions.geometry),
    'latest_date', e.latest_date,
    'track', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date', g.date,
            'geometry', extensions.st_asgeojson(g.geom)::jsonb,
            'magnitude_value', g.magnitude_value,
            'magnitude_unit', g.magnitude_unit
          )
          order by g.date, g.id
        )
        from public.event_geometries as g
        where g.event_id = e.id
      ),
      '[]'
    )
  )
  from public.events as e
  where e.id = event_detail.id;
$$;

create function public.categories()
returns table (id text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  with eonet_categories (id, title) as (
    values
      ('drought', 'Drought'),
      ('dustHaze', 'Dust and Haze'),
      ('earthquakes', 'Earthquakes'),
      ('floods', 'Floods'),
      ('landslides', 'Landslides'),
      ('manmade', 'Manmade'),
      ('seaLakeIce', 'Sea and Lake Ice'),
      ('severeStorms', 'Severe Storms'),
      ('snow', 'Snow'),
      ('tempExtremes', 'Temperature Extremes'),
      ('volcanoes', 'Volcanoes'),
      ('waterColor', 'Water Color'),
      ('wildfires', 'Wildfires')
  ),
  present as (
    select distinct unnest(e.categories) as id from public.events as e
  )
  select present.id, coalesce(eonet_categories.title, present.id)
  from present
  left join eonet_categories using (id)
  order by 2;
$$;

create function public.sync_status()
returns table (kind public.sync_kind, last_success_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, (
    select max(r.finished_at)
    from public.sync_runs as r
    where r.kind = k.kind and r.error is null and r.finished_at is not null
  )
  from unnest(enum_range(null::public.sync_kind)) as k (kind);
$$;

-- Privileges -----------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
grant execute on function public.upsert_events(jsonb) to service_role;

grant execute on function
  public.events_near(double precision, double precision, double precision, text[], integer),
  public.event_detail(text),
  public.categories(),
  public.sync_status()
  to anon, authenticated, service_role;
