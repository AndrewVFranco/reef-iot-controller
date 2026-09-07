// Reef Controller runtime configuration
// This file is served as a static asset and loaded before the React bundle.
// Edit this file directly on the Pi to update the API URL without rebuilding.
//
// In development, Vite's proxy rewrites /api and /ws so this value is unused.
// In production (served by FastAPI), this must point to the Pi's LAN address.

window.REEF_CONFIG = {
  apiUrl: "http://192.168.1.137:8000",
  wsUrl:  "ws://192.168.1.137:8000",
};
