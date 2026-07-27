# Design Spec: Security, Reliability, and Cleanup Fixes

This design document outlines the changes to secure admin endpoints, intercept fetch requests on the frontend, handle body parsing safely on the backend, modify the password hashing salt source, and perform minor cleanups.

## 1. Secure Admin Endpoints (`backend/server.js`)
We will create a helper function `authorizeAdmin(req, res)` that:
- Reads the `Authorization` header.
- Verifies that the format is `Bearer <token>`.
- Verifies the token using the existing `verifyToken` function.
- Ensures the payload is valid and has `payload.role === 'admin'`.
- Returns the payload if successful, otherwise sends a `401 Unauthorized` or `403 Forbidden` response and returns `null`.

We will add a check at the top of the request handling logic in `server.js` (before checking the `/api/admin/*` paths) to intercept all requests to pathnames starting with `/api/admin/` and call `authorizeAdmin`. If it returns `null`, the request is aborted.

## 2. Intercept Fetch requests on Frontend (`frontend/app.js`)
We will override `window.fetch` at the very top of `frontend/app.js` (right after module imports) to intercept any URLs containing `/api/admin/`. If intercepted:
- Get the admin token from `localStorage` (`adminToken` or `kura_admin_token`).
- If found, append it as a `Bearer <token>` in the `Authorization` header.
- Support various header types (`Headers` object, header array, or plain object).

## 3. Secure Asynchronous Body Parsing & Limits (`backend/server.js`)
We will implement `parseJsonBody` and `readJsonBody` to:
- Read the body chunks from the request.
- Enforce a 1MB payload limit (`1024 * 1024` bytes) and reject with `Payload Too Large` if exceeded.
- Gracefully handle JSON parsing errors and reject with `Invalid JSON` if malformed.
- Implement `readJsonBody(req, res)` which catches these errors and responds with `413 Payload Too Large` or `400 Bad Request` accordingly.

The following POST endpoints will be converted to use `await readJsonBody(req, res)`:
- `/api/login` (POST)
- `/api/register` (POST)
- `/api/comments` (POST)
- `/api/chat` (POST)
- `/api/progress/*` (POST)
- `/api/favorites` (POST)
- `/api/admin/detect-intros` (POST)
- `/api/admin/save-episode-timings` (POST)

For all of these endpoints, database queries will be wrapped in separate try-catch blocks to catch SQLite/database exceptions and respond with a `500 Internal Server Error` in JSON format.

## 4. Environmental Password Salt
We will modify `hashPassword(password)` to check `process.env.PASSWORD_SALT` first, fallback to `process.env.JWT_SECRET`, and if both are undefined, default to `'kurasalt'`. This protects against salt hardcoding while preserving backward compatibility if neither env is set.

## 5. Minor Cleanup
We will remove the legacy bypass `if (token === 'kura_admin_token_active') return true;` from the `isAdmin` function in `frontend/app.js`.

---

## Verification and Testing Strategy
We will create a test suite in `tests/security.test.js` using Node.js's native test runner to verify:
1. `hashPassword` uses environment variables.
2. `parseJsonBody` successfully limits body size and parses valid JSON.
3. `/api/admin/` endpoints are rejected without a valid token.
4. Converted endpoints work correctly under normal and error conditions.
