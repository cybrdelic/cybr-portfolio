import { buildScene } from './instrument-trace-scene.mjs';

self.onmessage = ({ data }) => {
  try {
    const result = buildScene(data);
    const transfer = [result.geometry.buffer, result.attributes.buffer, result.nodes,
      result.acceleration.instanceOrder.buffer, result.acceleration.instanceSlots.buffer,
      ...result.acceleration.templates.flatMap(t => [t.order.buffer, t.boundaryIds.buffer])];
    self.postMessage(result, transfer);
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
