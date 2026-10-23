# Installation

## Install

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — runs the database.
- [DBeaver Community](https://dbeaver.io/download/) — GUI to browse the database.
- [PostgreSQL client tools](https://www.postgresql.org/download/) — optional, only if you want `psql` on the host.

## Start the database

From the repo root:

```bash
docker compose up -d
```

This starts PostgreSQL 17 with PostGIS 3.5. Check it is running with `docker compose ps`.

## Connect with DBeaver

New connection, PostgreSQL, then:

| Field | Value |
|---|---|
| Host | localhost |
| Port | 5433 |
| Database | fullyroutedb |
| User | postgres |
| Password | devfullyroute |

Port 5433 is intentional, so it does not collide with a local PostgreSQL on 5432.

## Run migrations

The `database/` folder is mounted inside the container at `/database`:

```bash
docker compose exec db psql -U postgres -d fullyroutedb -f /database/migrations/01_users.sql
```

## Reset

```bash
docker compose down -v
```

`-v` deletes the `pgdata` volume, so all data is lost.
