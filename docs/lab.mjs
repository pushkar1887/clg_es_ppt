import { ElevatorController, timing } from "./controller.mjs";
import { drawScope } from "./scope.mjs";

const tests = {
  startup: {
    floor: 1, stop: "ready", span: 360, rate: .55,
    help: "S1 is low. The controller confirms Floor 1 and enters IDLE with drive off.",
  },
  debounce: {
    floor: 1, target: 2, stop: "request", span: 40, rate: .026,
    help: "Watch raw B2 bounce. The firmware accepts one request after 20 ms of stable low input.",
  },
  up: {
    floor: 1, target: 2, stop: "arrival", span: 2_240, rate: 1,
    help: "EN goes high to drive up. When S2 goes low, the controller removes drive and confirms Floor 2.",
  },
  down: {
    floor: 2, target: 1, stop: "arrival", span: 2_240, rate: 1,
    help: "The bridge uses 1A / 2A = 0 / 1. S1 going low completes the trip to Floor 1.",
  },
  same: {
    floor: 1, target: 1, stop: "same", span: 160, rate: .12,
    help: "The requested floor equals the current floor. Watch the request complete with EN at zero.",
  },
  timeout: {
    floor: 1, target: 2, stop: "fault", span: 4_360, rate: 1, s2Open: true,
    help: "S2 stays high. At the 4 s travel deadline, the controller removes drive and signals FAULT.",
  },
};

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "play", "step", "restart", "fullscreen", "expectation", "motion", "indicator", "shaft", "car",
  "s1Tag", "s2Tag", "s2Open", "reset", "stateLabel", "state", "s1", "s2", "enable", "bridge", "current",
  "target", "elapsed", "scopeRange", "trace", "events", "announcement",
].map((id) => [id, byId(id)]));
const testButtons = [...document.querySelectorAll("[data-test]")];
const floorButtons = [...document.querySelectorAll("[data-floor]")];
const floorText = (floor) => floor ?? "—";

let selected;
let model;
let origin;
let mode;
let armed;
let automated;
let animation = 0;
let previousFrame = null;
let ticks = 0;
let logVersion = null;

function cancelPlayback() {
  if (animation) cancelAnimationFrame(animation);
  animation = 0;
  previousFrame = null;
  ticks = 0;
}

function selectTest(name) {
  cancelPlayback();
  selected = name;
  const test = tests[name];
  model = new ElevatorController({ floor: test.floor, s2Open: test.s2Open ?? false });
  if (name !== "startup") model.advance(timing.startup);
  origin = model.time;
  mode = "ready";
  armed = true;
  automated = true;
  logVersion = null;
  ui.expectation.textContent = test.help;
  for (const button of testButtons) button.setAttribute("aria-pressed", String(button.dataset.test === name));
  render();
}

function armTrip() {
  if (!armed) return;
  armed = false;
  const { target } = tests[selected];
  if (target) model.press(target);
}

function isTerminal(event) {
  if (event.kind === "fault") return true;
  if (automated && event.kind === tests[selected].stop) return true;
  return event.kind === "arrival";
}

function terminalSince(sequence) {
  if (sequence === model.sequence) return false;
  return model.events.some((event) => event.id > sequence && isTerminal(event));
}

function finish() {
  if (automated && selected === "debounce" && model.snapshot().accepted === 1) model.advance(1);
  cancelPlayback();
  mode = "complete";
}

function playFrame(timestamp) {
  if (mode !== "playing") return;
  const rate = automated ? tests[selected].rate : 1;
  ticks += Math.min(60, timestamp - (previousFrame ?? timestamp)) * rate;
  previousFrame = timestamp;
  const count = Math.floor(ticks);
  ticks -= count;
  if (count) {
    const sequence = model.sequence;
    model.advance(count, () => terminalSince(sequence) || !model.hasWork);
    if (terminalSince(sequence) || !model.hasWork) finish();
  }
  render();
  if (mode === "playing") animation = requestAnimationFrame(playFrame);
}

function startPlayback() {
  cancelPlayback();
  mode = "playing";
  animation = requestAnimationFrame(playFrame);
  render();
}

function nextEvent() {
  if (mode === "complete") return;
  cancelPlayback();
  armTrip();
  const sequence = model.sequence;
  model.advance(timing.timeout + timing.startup, () => model.sequence !== sequence || !model.hasWork);
  if (terminalSince(sequence) || !model.hasWork) finish();
  else mode = "paused";
  render();
}

function drawTrace(view) {
  const span = automated ? tests[selected].span : 4_360;
  const actual = view.time - origin;
  const end = Math.max(span, actual);
  const start = Math.max(0, end - span);
  const keys = automated && selected === "debounce" ? ["b2", "accepted"] : selected === "timeout" ? ["s2", "enable"] : ["s1", "s2", "enable"];
  const move = model.events.findLast((event) => event.kind === "move");
  const deadline = selected === "timeout" && move ? move.time - origin + timing.timeout : null;
  ui.scopeRange.textContent = Math.round(start) + "–" + Math.round(end) + " ms";
  ui.trace.setAttribute("aria-label", keys.includes("b2") ? "Simulated raw B2 and request traces" : "Simulated floor switch and enable traces");
  drawScope(ui.trace, model.trace.map((sample) => ({ ...sample, time: sample.time - origin })), {
    start, end, now: actual, keys, deadline, fault: view.state === "FAULT",
  });
}

function renderLog() {
  if (logVersion === model.sequence) return;
  logVersion = model.sequence;
  const last = model.events.filter((event) => event.time >= origin).slice(-3).reverse();
  const rows = last.map((event) => {
    const row = document.createElement("li");
    if (event.kind === "fault") row.className = "fault";
    const when = document.createElement("time");
    const seconds = ((event.time - origin) / 1_000).toFixed(3);
    when.dateTime = "PT" + seconds + "S";
    when.textContent = seconds + " s";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("p");
    detail.textContent = event.detail;
    body.append(title, detail);
    row.append(when, body);
    return row;
  });
  ui.events.replaceChildren(...rows);
  if (last.length) ui.announcement.textContent = last[0].title + ". " + last[0].detail;
}

function render() {
  const view = model.snapshot();
  const fault = view.state === "FAULT";
  const physicalLocation = view.position === 0 ? "at Floor 1" : view.position === 1 ? "at Floor 2" : "between floors";
  ui.car.style.bottom = (12 + 56 * view.position) + "%";
  ui.car.classList.toggle("fault", fault);
  ui.shaft.setAttribute("aria-label", "Car " + physicalLocation);
  ui.motion.textContent = view.direction === 1 ? "Drive up" : view.direction === -1 ? "Drive down" : "Drive off";
  ui.indicator.textContent = floorText(view.currentFloor);
  ui.s1Tag.classList.toggle("active", view.s1 === 0);
  ui.s2Tag.classList.toggle("active", view.s2 === 0);
  ui.s2Open.checked = view.s2Open;
  ui.state.textContent = view.state;
  ui.stateLabel.classList.toggle("fault", fault);
  ui.s1.textContent = view.s1;
  ui.s2.textContent = view.s2;
  ui.enable.textContent = view.enable;
  ui.s1.classList.toggle("active", view.s1 === 0);
  ui.s2.classList.toggle("active", view.s2 === 0);
  ui.enable.classList.toggle("active", view.enable === 1);
  ui.bridge.textContent = view.a1 + " / " + view.a2;
  ui.current.textContent = floorText(view.currentFloor);
  ui.target.textContent = floorText(view.targetFloor);
  ui.elapsed.textContent = (view.elapsed / 1_000).toFixed(3) + " s";
  ui.elapsed.classList.toggle("fault", fault);
  ui.play.textContent = { ready: "Run test", playing: "Pause", paused: "Resume", complete: "Replay test" }[mode];
  ui.step.disabled = mode === "complete";
  for (const button of floorButtons) button.disabled = view.state !== "IDLE" || model.hasWork;
  renderLog();
  drawTrace(view);
}

for (const button of testButtons) button.addEventListener("click", () => selectTest(button.dataset.test));
for (const button of floorButtons) {
  button.addEventListener("click", () => {
    if (!model.press(Number(button.dataset.floor))) return;
    automated = false;
    armed = false;
    startPlayback();
  });
}
ui.play.addEventListener("click", () => {
  if (mode === "playing") {
    cancelPlayback();
    mode = "paused";
    render();
    return;
  }
  if (mode === "complete") selectTest(selected);
  armTrip();
  startPlayback();
});
ui.step.addEventListener("click", nextEvent);
ui.restart.addEventListener("click", () => selectTest(selected));
ui.s2Open.addEventListener("change", () => {
  model.setS2Open(ui.s2Open.checked);
  render();
});
ui.reset.addEventListener("click", () => {
  model.reset();
  automated = false;
  armed = false;
  startPlayback();
});
if (document.fullscreenEnabled) {
  ui.fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      ui.announcement.textContent = "Full screen is unavailable in this browser.";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    ui.fullscreen.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  });
} else {
  ui.fullscreen.hidden = true;
}

const requested = new URLSearchParams(location.search).get("test");
selectTest(Object.hasOwn(tests, requested) ? requested : "startup");
new ResizeObserver(() => drawTrace(model.snapshot())).observe(ui.trace);
