const pale = "#d7e7de";
const active = "#9ae7ce";
export const signals = Object.freeze({
  s1: { label: "S1", color: pale },
  s2: { label: "S2", color: pale },
  b1: { label: "B1", color: pale },
  b2: { label: "B2", color: pale },
  accepted: { label: "REQ", color: active },
  a1: { label: "1A", color: pale },
  a2: { label: "2A", color: pale },
  p12: { label: "P1.2", color: pale },
  enable: { label: "EN", color: active },
});

export const groups = Object.freeze({
  position: { keys: ["s1", "s2", "enable"], description: "Logic traces of S1, S2, and EN" },
  buttons: { keys: ["b1", "b2", "accepted"], description: "Logic traces of B1, B2, and the accepted request pulse" },
  bridge: { keys: ["a1", "a2", "p12", "enable"], description: "Logic traces of 1A, 2A, P1.2, and EN" },
});

export function sampleAt(trace, time) {
  return trace.findLast((sample) => sample.time <= time) ?? trace[0];
}

const plotLeft = 54;
const plotRightMargin = 12;

export function cursorFromPointer(canvas, event, { start, end }) {
  const rect = canvas.getBoundingClientRect();
  const fraction = (event.clientX - rect.left - plotLeft) / (rect.width - plotLeft - plotRightMargin);
  return Math.round(start + Math.max(0, Math.min(1, fraction)) * (end - start));
}

function timeLabel(time, end) {
  if (end < 1_000) return Math.round(time) + " ms";
  return (time / 1_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " s";
}

export function drawScope(canvas, trace, { start, end, now, origin, keys, cursor, deadline }) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(bounds.width * scale);
  const pixelHeight = Math.round(bounds.height * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  const height = bounds.height;
  const right = bounds.width - plotRightMargin;
  const bottom = height - 27;
  const beginning = 8;
  const rowHeight = (bottom - beginning) / keys.length;
  const x = (time) => plotLeft + (time - start) * (right - plotLeft) / (end - start);
  const grid = "#30473b";
  const baseline = "#b0c6b9";

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, bounds.width, height);
  ctx.font = "12px ui-monospace, monospace";
  ctx.lineWidth = 1;
  ctx.strokeStyle = grid;
  ctx.fillStyle = baseline;
  const divisions = Math.min(4, Math.max(2, Math.floor((right - plotLeft) / 80)));
  for (let tick = 0; tick <= divisions; tick++) {
    const time = start + (end - start) * tick / divisions;
    const here = x(time);
    ctx.beginPath();
    ctx.moveTo(here, beginning);
    ctx.lineTo(here, bottom);
    ctx.stroke();
    ctx.textAlign = tick === 0 ? "left" : tick === divisions ? "right" : "center";
    ctx.fillText(timeLabel(time, end), here, height - 9);
  }

  for (const [row, key] of keys.entries()) {
    const middle = beginning + (row + .5) * rowHeight;
    const high = middle - Math.min(rowHeight * .22, 10);
    const low = middle + Math.min(rowHeight * .22, 10);
    const level = (bit) => bit ? high : low;
    const meta = signals[key];
    ctx.textAlign = "left";
    ctx.fillStyle = baseline;
    ctx.fillText(meta.label, 9, middle + 4);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, high);
    ctx.lineTo(right, high);
    ctx.moveTo(plotLeft, low);
    ctx.lineTo(right, low);
    ctx.stroke();

    const initial = sampleAt(trace, start + origin);
    if (!initial) continue;
    const present = Math.max(start, Math.min(now, end));
    let bit = initial[key];
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(plotLeft, level(bit));
    for (const sample of trace) {
      const time = sample.time - origin;
      if (time <= start || time > present || sample[key] === bit) continue;
      ctx.lineTo(x(time), level(bit));
      bit = sample[key];
      ctx.lineTo(x(time), level(bit));
    }
    ctx.lineTo(x(present), level(bit));
    ctx.stroke();
  }

  for (const [time, color, dashes] of [[cursor, "#9ae7ce", []], [deadline, "#f7ca89", [3, 4]]]) {
    if (time === null || time < start || time > end) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashes);
    ctx.beginPath();
    ctx.moveTo(x(time), beginning);
    ctx.lineTo(x(time), bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
