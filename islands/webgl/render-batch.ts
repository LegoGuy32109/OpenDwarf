/// <reference lib="dom" />

export type InstanceBatchStats = {
  drawCalls: number;
  instances: number;
};

export function flushInstanceBatch(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  scratch: Float32Array,
  count: number,
  stats: InstanceBatchStats,
) {
  if (count === 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, count * 8));
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  stats.drawCalls++;
  stats.instances += count;
}
