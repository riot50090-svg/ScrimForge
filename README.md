# ScrimForge V2

A real backend-backed version of the ScrimForge V1 demo.

## What changed
- Admin passwords are stored as bcrypt hashes, not plain text/localStorage.
- Admin login uses a server session.
- Registrations are stored in SQLite, so all visitors/admin sessions use the same database.
- Admin can confirm/reject registrations.
- Lobby counts are calculated from confirmed registrations.
- Results can be added from the admin dashboard.
- Public registration no longer depends on browser localStorage.

## Run locally

Requirements: Node.js 18+.

```bash
npm install
```

Set a strong session secret before production:

```bash
SESSION_SECRET="put-a-long-random-secret-here" npm start
```

Then open http://localhost:3000.

On first run, use **Create first admin** once. After an admin exists, public setup is disabled. You can use the same email/password as your old V1 admin account; the server stores a secure password hash.

## Important
The old browser-only admin account from V1 cannot be securely migrated automatically because V1 stored its password in localStorage. Create the admin account once in V2 using the same email/password if you want to keep the same credentials.

For production, deploy this Node app on a server/host with persistent disk or replace SQLite with a managed database.


## How registration and dashboard connect

A visitor submits a registration to `/api/registrations`. It is stored in SQLite with status `pending`. An authenticated admin dashboard reads the same database, so a registration made from another phone or computer appears in the dashboard. When the admin confirms or rejects it, the status is updated in the same database and lobby capacity updates for visitors.
