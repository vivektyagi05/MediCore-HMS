# Bug Fixes Report

## Security Fixes

- Restricted public registration to `patient` and `doctor` roles only.
- Removed the public admin role option from the registration page.
- Updated backend auth validation so `admin`, `super_admin`, and `receptionist` accounts cannot be self-created through `/api/auth/register`.
- Reworked backend API tests to bootstrap an admin directly through the model layer instead of depending on insecure public admin registration.

## Role And Permission Fixes

- Updated doctor administration routes so both `admin` and `super_admin` can create, update, and delete doctors.
- Fixed admin permission checks to support both Mongoose `Map` values and plain serialized permission objects.
- Connected admin services and settings pages into the protected admin route tree.
- Updated sidebar navigation so admin Services and Settings link to real screens instead of placeholder dashboard targets.

## Runtime Fixes

- Hardened backend environment loading so `backend/.env` is resolved consistently whether the backend is started from the root package or from inside `backend/`.
- Added automatic upload directory creation for doctor documents, patient reports, and insurance uploads.
- Added a guarded backend seed module that does not execute during normal source imports.
- Updated backend API tests to use `HMS_TEST_MONGO_URI` or a local test database before falling back to `mongodb-memory-server`, avoiding brittle binary downloads in normal local validation.

## Package And Operations Fixes

- Added root scripts for frontend dev, backend dev, backend tests, and backend seeding.
- Added backend seed script.
- Added root `.env.example` for frontend API configuration.
- Expanded `backend/.env.example` with seed super admin variables.
- Added project setup and validation instructions in `README.md`.

## Validation Results

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:backend`: passed.
- Frontend dependency audit: passed with 0 vulnerabilities.
- Backend dependency audit: passed with 0 vulnerabilities.
- Backend source import audit: passed across 123 source files.
