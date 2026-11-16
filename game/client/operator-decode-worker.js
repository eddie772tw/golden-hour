import { decodeOperators } from "./startup-geometry.js";

self.onmessage = ({ data: { buffer, version } }) => {
  try {
    const start = performance.now();
    const decoded = decodeOperators(buffer, version);
    // Geometry views share the downloaded pack. Paeth textures own new buffers.
    const transfers = new Set([buffer]);
    for (const texture of decoded.materials?.textures || []) transfers.add(texture.data.buffer);
    self.postMessage({
      operators: decoded.slice(), grips: decoded.grips, materials: decoded.materials,
      decodeMs: performance.now() - start,
    }, [...transfers]);
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
