const inputs = {
  s1: { name: "S1", color: "#e0ece5" },
  s2: { name: "S2", color: "#e0ece5" },
  b2: { name: "B2", color: "#e0ece5" },
  accepted: { name: "REQ", color: "#8bdfc7" },
  enable: { name: "EN", color: "#8bdfc7" },
};

export function drawScope(canvas, trace, { start, end, now, keys, deadline = null, fault = false }) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * ratio);
  const pixelHeight = Math.round(rect.height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  const left = 49;
  const right = width - 11;
  const plotBottom = height - 28;
  const rowHeight = (plotBottom - 8) / keys.length;
  const x = (time) => left + (time - start) * (right - left) / (end - start);

  ctx.font = "11px ui-monospace, monospace";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#2e4741";
  ctx.fillStyle = "#b3c9c0";
  ctx.textAlign = "center";
  for (let tick = 0; tick <= 4; tick++) {
    const time = start + (end - start) * tick / 4;
    const tickX = x(time);
    ctx.beginPath();
    ctx.moveTo(tickX, 9);
    ctx.lineTo(tickX, plotBottom + 2);
    ctx.stroke();
    const value = end >= 1_000 ? (time / 1_000).toFixed(1) + "s" : Math.round(time) + "ms";
    ctx.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
    ctx.fillText(value, tickX, height - 10);
  }

  for (const [row, key] of keys.entries()) {
    const meta = inputs[key];
    const middle = 8 + (row + .5) * rowHeight;
    const high = middle - Math.min(10, rowHeight * .28);
    const low = middle + Math.min(10, rowHeight * .28);
    const level = (bit) => bit ? high : low;
    ctx.textAlign = "left";
    ctx.fillStyle = "#b3c9c0";
    ctx.fillText(meta.name, 1, middle + 4);
    ctx.fillStyle = "#91a9a0";
    ctx.fillText("1", left - 14, high + 3);
    ctx.fillText("0", left - 14, low + 3);
    ctx.strokeStyle = "#2e4741";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, high);
    ctx.lineTo(right, high);
    ctx.moveTo(left, low);
    ctx.lineTo(right, low);
    ctx.stroke();

    const initial = trace.findLast((sample) => sample.time <= start) ?? trace[0];
    if (!initial) continue;
    const present = Math.max(start, Math.min(now, end));
    let bit = initial[key];
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(left, level(bit));
    for (const sample of trace) {
      if (sample.time <= start || sample.time > present || sample[key] === bit) continue;
      ctx.lineTo(x(sample.time), level(bit));
      bit = sample[key];
      ctx.lineTo(x(sample.time), level(bit));
    }
    ctx.lineTo(x(present), level(bit));
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.arc(x(present), level(bit), 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (deadline !== null && deadline >= start && deadline <= end) {
    ctx.strokeStyle = fault ? "#ffd08a" : "#8e9e95";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x(deadline), 5);
    ctx.lineTo(x(deadline), plotBottom + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
