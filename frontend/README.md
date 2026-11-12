# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Transit API availability

Transit API consumers should use the response metadata rather than treating an empty vehicle list as a live zero:

- `success` and `dataAvailable` indicate whether usable data was returned.
- `isCached` identifies previously received provider data; `isFallback` identifies canonical route/stop data that is not live telemetry.
- `upstreamReachable` and `timestamp` describe the latest request, while `cacheTimestamp` identifies when cached telemetry was observed.
- A successful live response with an empty `respData` is a genuine zero-bus result. An unavailable response (normally HTTP 503) is not.

Route data may be returned as `respData` containing an array of stops, or as an object containing `stops` and `buses`. The route-search view accepts both shapes and labels live, cached, fallback, and unavailable bus information separately.

The Vercel API is request-driven: in-memory sessions and caches are not shared across instances or durable, and it does not run a continuous background polling worker. Continuous telemetry requires a persistent worker and shared durable storage.

## Local development

Run the backend and frontend in separate terminals:

```powershell
npm --prefix backend start
npm --prefix frontend run dev
```

Vite proxies `/api` requests to the local backend on port `11000` in development. Set `VITE_API_BASE_URL` when using a different API origin; production builds default to the deployed Vercel API.

The backend loads local variables from `backend/.env` regardless of the launch directory; keep JCTSL credentials server-side. Locally, an OTP-verified session is saved as only its required auth fields in the git-ignored `backend/.session.json`, using an atomic write and restrictive file permissions. After restart, the backend verifies the saved session with JCTSL before activating it. A provider rejection clears the saved session and requires authorized authentication again; network, HTML, and malformed-response failures do not prove the session is invalid and are reported as verification failures. `/api/auth/session` performs this verification when it encounters a restored session. Vercel instances do not share or durably retain local session files, and Vercel does not run a continuous background polling worker.
