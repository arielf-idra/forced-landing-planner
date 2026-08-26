// Runway-strip texture for the landing-strip polyline's material. Cesium maps an image
// material's U axis along a polyline's length and V axis across its width, so a wide image
// (width >> height) stretches to fill however long the strip line actually is — no separate
// scaling logic needed on our side.
//
// Explicit width/height on the root <svg> (not just viewBox) — same requirement as the
// aircraft icon; omitting them can rasterize to an invalid image and fail as a WebGL texture.
const RUNWAY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40" viewBox="0 0 400 40">
  <rect width="400" height="40" fill="#4a4a4a" />
  <rect x="0" y="1" width="400" height="2" fill="white" />
  <rect x="0" y="37" width="400" height="2" fill="white" />
  <g fill="white">
    <rect x="8" y="6" width="4" height="10" />
    <rect x="16" y="6" width="4" height="10" />
    <rect x="24" y="6" width="4" height="10" />
    <rect x="8" y="24" width="4" height="10" />
    <rect x="16" y="24" width="4" height="10" />
    <rect x="24" y="24" width="4" height="10" />
    <rect x="368" y="6" width="4" height="10" />
    <rect x="376" y="6" width="4" height="10" />
    <rect x="384" y="6" width="4" height="10" />
    <rect x="368" y="24" width="4" height="10" />
    <rect x="376" y="24" width="4" height="10" />
    <rect x="384" y="24" width="4" height="10" />
  </g>
  <g fill="white">
    <rect x="40" y="18" width="20" height="4" />
    <rect x="80" y="18" width="20" height="4" />
    <rect x="120" y="18" width="20" height="4" />
    <rect x="160" y="18" width="20" height="4" />
    <rect x="200" y="18" width="20" height="4" />
    <rect x="240" y="18" width="20" height="4" />
    <rect x="280" y="18" width="20" height="4" />
    <rect x="320" y="18" width="20" height="4" />
  </g>
</svg>
`.trim()

export const RUNWAY_TEXTURE_DATA_URI = `data:image/svg+xml;base64,${btoa(RUNWAY_SVG)}`
