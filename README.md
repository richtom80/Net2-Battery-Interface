# Net2 Battery Interface

Reads **wireless door-lock battery levels** from a [Paxton Net2](https://www.paxton-access.com/) access-control system and presents them two ways:

- a **live web dashboard** — sortable table, triage filters, per-lock battery meter, signal strength and last-heartbeat;
- a **printable PDF worksheet** — locks sorted worst-battery-first with blank *Date replaced* / *Initials* boxes to fill in while walking the building.

Net2 keeps all its data in a Microsoft SQL Server database, so this tool talks to that database directly (read-only) rather than to any REST API.

> **Battery scale:** Net2 Nano wireless locks report battery as a **0–10** value (10 = full), not a percentage. This tool treats `0–2` as *critical*, `3–4` as *low*, and `5–10` as *healthy*.

---

## What you need

- A reachable **Net2 SQL Server** instance (SQL Express is the Paxton default, installed as a named instance `NET2`).
- A **read-only SQL login** for that database (see [Create a read-only login](#2-create-a-read-only-sql-login)).
- **Node.js 18+** (for the dashboard and data export).
- **Python 3.9+** (only for generating the PDF worksheet).

---

## Setup from scratch

### 1. Clone and install

```bash
git clone https://github.com/<your-account>/Net2-Battery-Interface.git
cd Net2-Battery-Interface
npm install
```

### 2. Create a read-only SQL login

Net2's installer protects the raw `dbo` tables and exposes a supported,
read-only view layer in the **`sdk` schema**, reachable through the
built-in **`sdk_reader`** database role. Create a dedicated login and add it
to that role. On the Net2 server, in an elevated command prompt (adjust the
instance name if yours differs), using an account that has sysadmin on the
SQL instance:

```sql
sqlcmd -S .\NET2 -E -Q "CREATE LOGIN [net2_battery_reader] WITH PASSWORD = N'<a-strong-password>', CHECK_POLICY = ON;"
sqlcmd -S .\NET2 -E -d Net2 -Q "CREATE USER [net2_battery_reader] FOR LOGIN [net2_battery_reader];"
sqlcmd -S .\NET2 -E -d Net2 -Q "ALTER ROLE sdk_reader ADD MEMBER [net2_battery_reader];"
```

> `sdk_reader` grants `SELECT` on the `sdk` views only, and the schema
> explicitly denies write/raw access — so this login cannot change anything
> or read beyond the reporting views. That is exactly what we want.

If you'd rather not create a login, any SQL account that is a member of
`sdk_reader` on the `Net2` database will work.

### 3. Configure your connection

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | What it is |
|---|---|
| `DB_SERVER` | IP / hostname of the Net2 SQL Server (no instance or port here) |
| `DB_INSTANCE` | Named instance — Paxton's default is `NET2`. Leave blank if you use `DB_PORT`. |
| `DB_PORT` | Only if you know the exact TCP port and named-instance discovery is blocked |
| `DB_DATABASE` | Database name — usually `Net2` |
| `DB_AUTH_TYPE` | `sql` for a SQL login, `ntlm` for Windows authentication |
| `DB_USER` / `DB_PASSWORD` | Your read-only login |
| `DB_ENCRYPT` / `DB_TRUST_SERVER_CERT` | For a LAN instance with a self-signed cert, keep `false` / `true` |

> Quote the password in `.env` if it contains `#` or other special
> characters (`DB_PASSWORD="p@ss#1"`), or dotenv will cut it off at the `#`.

### 4. (Optional) Confirm the schema

Different Net2 versions can vary. This script connects and lists any
tables/views and columns that look battery- or door-related, so you can
confirm `sdk.Net2NanoDevices` (or the equivalent) exists before relying on
it:

```bash
npm run discover
```

### 5. Run the dashboard

```bash
npm start
# open http://localhost:3000
```

Columns are sortable; the Critical / Low / Healthy tallies double as
filters; rows load sorted lowest-battery-first.

---

## Generating the PDF worksheet

The worksheet needs Python with `reportlab`:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Then export the current data and build the PDF:

```bash
mkdir -p reports
npm run dump > reports/battery-data.json
.venv/bin/python scripts/make-report.py reports/battery-data.json reports/battery-worksheet.pdf
```

`reports/battery-worksheet.pdf` is a clipboard-ready A4 sheet: every lock on
its own row, worst battery first, colour-coded by status, with blank boxes
for the date replaced and the engineer's initials.

> On Windows use `.venv\Scripts\python` instead of `.venv/bin/python`.

---

## Project layout

```
src/
  config.js              Builds the SQL connection config from .env
  db.js                  Connection pool
  server.js              Express app serving the dashboard + /api/battery-levels
  queries/batteryLevels.js   The one query (reads sdk.Net2NanoDevices)
scripts/
  discover-schema.js     Schema discovery helper
  dump-data.js           Prints current data as JSON (for the PDF)
  make-report.py         Builds the printable PDF worksheet
public/
  index.html             The dashboard (single file, no build step)
```

## Security notes

- `.env` holds your database credentials and is **git-ignored** — never
  commit it. Only `.env.example` (placeholders) is tracked.
- Generated data (`reports/`, `*.pdf`, `discovery-results.json`) contains
  real door names and locations and is git-ignored too.
- The database login should be read-only (`sdk_reader`). Don't point this at
  a privileged account.
