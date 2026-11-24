import { ElevatorController, timing } from "./controller.mjs?v=2";
import { scenarios } from "./scenarios.mjs?v=2";
import { cursorFromPointer, drawScope, groups, sampleAt, signals } from "./scope.mjs?v=2";

const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "play", "step", "step-ms", "restart", "fullscreen", "case-title", "expectation", "verdict",
  "motion", "indicator", "shaft", "car", "s1Tag", "s2Tag", "sensor-mode", "reset", "speed",
  "simulated-time", "state", "pin-b1", "pin-b2", "pin-s1", "pin-s2", "pin-a1", "pin-a2", "pin-p12",
  "enable", "current", "target", "elapsed", "scope-time", "scope-live", "trace", "cursor",
  "scope-values", "events", "announcement",
].map((id) => [id, byId(id)]));
const cases = [...document.querySelectorAll("[data-test]")];
const floorButtons = [...document.querySelectorAll("[data-floor]")];
const scopeButtons = [...document.querySelectorAll("[data-scope]")];
const machineStates = [...document.querySelectorAll("[data-machine-state]")];
const clockText = (milliseconds) => milliseconds < 1_000 ? milliseconds + " ms" : (milliseconds / 1_000).toFixed(3) + " s";

let selected;
let model;
let origin;
let mode;
let armed;
let automated;
let scope;
let cursor = null;
let scopeValues = {};
let plot;
let frame = 0;
let previousFrame = null;
let ticks = 0;
let logVersion = null;

function setText(node, value) {
  const text = String(value ?? "—");
  if (node.textContent !== text) node.textContent = text;
}

function setPressed(node, pressed) {
  const value = String(pressed);
  if (node.getAttribute("aria-pressed") !== value) node.setAttribute("aria-pressed", value);
}

function cancelPlayback() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  previousFrame = null;
  ticks = 0;
}

function selectScope(name) {
  scope = name;
  scopeValues = {};
  elements.trace.setAttribute("aria-label", groups[scope].description);
  for (const button of scopeButtons) setPressed(button, button.dataset.scope === name);
  const values = groups[scope].keys.map((key) => {
    const pair = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = signals[key].label;
    value.dataset.scopeValue = key;
    scopeValues[key] = value;
    pair.append(term, value);
    return pair;
  });
  elements["scope-values"].replaceChildren(...values);
}

function selectTest(name, changeURL = false) {
  cancelPlayback();
  selected = name;
  const test = scenarios[name];
  model = new ElevatorController({ floor: test.floor, s2Mode: test.s2Mode ?? "normal" });
  if (name !== "startup") model.advance(timing.startup);
  origin = model.time;
  mode = "ready";
  armed = true;
  automated = true;
  cursor = null;
  logVersion = null;
  elements.speed.value = test.speed;
  setText(elements["case-title"], test.title);
  setText(elements.expectation, test.detail);
  for (const button of cases) setPressed(button, button.dataset.test === name);
  selectScope(test.scope);
  if (changeURL) {
    const url = new URL(location.href);
    url.searchParams.set("test", name);
    history.replaceState(null, "", url);
  }
  render();
}

function startTest() {
  if (!armed) return;
  armed = false;
  const { target } = scenarios[selected];
  if (target) model.press(target);
}

function isTerminal(event) {
  return event.kind === "fault" || event.kind === "arrival" ||
    (automated && selected !== "debounce" && event.kind === scenarios[selected].stop);
}

function awaitingPulseEnd() {
  return automated && selected === "debounce" && model.accepted === 1;
}

function terminalSince(sequence) {
  if (automated && selected === "debounce" && !awaitingPulseEnd() &&
      model.events.some((event) => event.kind === "request" && event.time >= origin)) return true;
  return model.sequence !== sequence && model.events.some((event) => event.id > sequence && isTerminal(event));
}

function finish() {
  cancelPlayback();
  mode = "complete";
}

function playFrame(timestamp) {
  if (mode !== "playing") return;
  ticks += Math.min(60, timestamp - (previousFrame ?? timestamp)) * Number(elements.speed.value);
  previousFrame = timestamp;
  const count = Math.floor(ticks);
  ticks -= count;
  if (count) {
    const sequence = model.sequence;
    model.advance(count, () => terminalSince(sequence) || !model.hasWork);
    if (terminalSince(sequence) || !model.hasWork) finish();
  }
  render();
  if (mode === "playing") frame = requestAnimationFrame(playFrame);
}

function startPlayback() {
  cancelPlayback();
  mode = "playing";
  cursor = null;
  frame = requestAnimationFrame(playFrame);
  render();
}

function step(advanceToEvent) {
  if (mode === "complete") return;
  cancelPlayback();
  cursor = null;
  startTest();
  const sequence = model.sequence;
  if (advanceToEvent) {
    model.advance(timing.timeout + timing.startup,
      () => !awaitingPulseEnd() && (terminalSince(sequence) || model.sequence !== sequence || !model.hasWork));
  } else {
    model.advance(1);
  }
  if (terminalSince(sequence) || !model.hasWork) finish();
  else mode = "paused";
  render();
}

function updateCursorSelection() {
  for (const event of elements.events.querySelectorAll("button[data-time]")) {
    setPressed(event, cursor?.eventId === Number(event.dataset.event));
  }
}

function setCursor(time, eventId = null) {
  const from = Math.max(0, model.trace[0].time - origin);
  cursor = time === null ? null : { time: Math.max(from, Math.min(model.time - origin, time)), eventId };
  updateCursorSelection();
  renderScope(model.snapshot());
}

function renderScope(view) {
  const span = automated ? scenarios[selected].span : 4_360;
  const now = view.time - origin;
  const first = Math.max(0, model.trace[0].time - origin);
  const latestEnd = Math.max(span, now);
  const end = cursor === null || cursor.time >= latestEnd - span ? latestEnd : Math.max(span, cursor.time + Math.round(span * .72));
  const start = Math.min(end - 1, Math.max(first, end - span));
  const time = cursor?.time ?? now;
  const { keys } = groups[scope];
  const move = model.events.findLast((event) => event.kind === "move");
  const timeout = model.events.findLast((event) => event.kind === "fault" && event.fault === "timeout");
  let deadline = timeout ? timeout.time - origin : null;
  if (view.state === "MOVING" && view.s2Mode === "open" && move) deadline = move.time - origin + timing.timeout;
  plot = { start, end, now, origin, keys, cursor: time, deadline };
  setText(elements["scope-time"], (cursor === null ? "Live · " : "Cursor · ") + clockText(time));
  elements["scope-live"].disabled = cursor === null;
  elements.cursor.min = String(first);
  elements.cursor.max = String(now);
  elements.cursor.value = String(time);
  elements.cursor.disabled = first === now;
  elements.cursor.setAttribute("aria-valuetext", clockText(time));
  const selectedEvent = model.events.find((event) => event.id === cursor?.eventId);
  const sample = selectedEvent?.signals ?? sampleAt(model.trace, time + origin);
  for (const key of keys) setText(scopeValues[key], sample[key]);
  drawScope(elements.trace, model.trace, plot);
}

function renderLog() {
  if (logVersion === model.sequence) return;
  logVersion = model.sequence;
  const events = model.events.filter((event) => event.time >= origin).slice(-14).reverse();
  const focusedId = document.activeElement?.dataset.event;
  const rows = events.map((event) => {
    const row = document.createElement("li");
    if (event.kind === "fault") row.className = "fault";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.event = String(event.id);
    const offset = event.time - origin;
    button.dataset.time = String(offset);
    button.setAttribute("aria-label", event.title + " at " + clockText(offset));
    const time = document.createElement("time");
    time.dateTime = "PT" + (offset / 1_000).toFixed(3) + "S";
    time.textContent = clockText(offset);
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("p");
    detail.id = "event-detail-" + event.id;
    detail.textContent = event.detail;
    button.setAttribute("aria-describedby", detail.id);
    body.append(title, detail);
    button.append(time, body);
    row.append(button);
    return row;
  });
  elements.events.replaceChildren(...rows);
  updateCursorSelection();
  if (focusedId) elements.events.querySelector('[data-event="' + focusedId + '"]')?.focus({ preventScroll: true });
  if (events.length) setText(elements.announcement, events[0].title + ". " + events[0].detail);
}

function renderVerdict(view) {
  let result = mode;
  let label = { ready: "Ready", playing: "Running", paused: "Paused", complete: "Complete" }[mode];
  if (automated && mode === "complete") {
    const matches = scenarios[selected].check(view, model.events.filter((entry) => entry.time >= origin),
      model.trace.filter((sample) => sample.time >= origin));
    result = matches ? "passed" : "different";
    label = matches ? "Passed" : "Outcome differs";
  } else if (!automated) {
    label = view.state === "FAULT" ? "Manual fault" : "Manual control";
    if (view.state === "FAULT") result = "different";
  } else if (mode === "playing") {
    result = "running";
  }
  elements.verdict.dataset.result = result;
  setText(elements.verdict, label);
}

function render() {
  const view = model.snapshot();
  const fault = view.state === "FAULT";
  const location = view.position === 0 ? "at Floor 1" : view.position === 1 ? "at Floor 2" : "between floors";
  elements.car.style.bottom = (13 + 54 * view.position) + "%";
  elements.car.classList.toggle("fault", fault);
  elements.shaft.setAttribute("aria-label", "Car " + location);
  const motion = view.direction === 1 ? "Drive up" : view.direction === -1 ? "Drive down" : "Drive off";
  setText(elements.motion, motion + " · " + location);
  setText(elements.indicator, view.currentFloor);
  setText(elements.current, view.currentFloor);
  setText(elements.target, view.targetFloor);
  setText(elements.elapsed, (view.elapsed / 1_000).toFixed(3) + " s");
  elements.elapsed.classList.toggle("fault", fault);
  elements["sensor-mode"].value = view.s2Mode;
  setText(elements.state, view.state);
  elements.state.classList.toggle("fault", fault);
  for (const node of machineStates) {
    if (node.dataset.machineState === view.state) node.setAttribute("aria-current", "true");
    else node.removeAttribute("aria-current");
  }
  for (const key of ["b1", "b2", "s1", "s2", "a1", "a2", "p12"]) setText(elements["pin-" + key], view[key]);
  for (const key of ["b1", "b2", "s1", "s2", "p12"]) elements["pin-" + key].classList.toggle("active", view[key] === 0);
  for (const [tag, bit] of [[elements.s1Tag, view.s1], [elements.s2Tag, view.s2]]) {
    setText(tag.lastElementChild, bit);
    tag.classList.toggle("active", bit === 0);
  }
  setText(elements.enable, view.enable);
  elements.enable.classList.toggle("active", view.enable === 1);
  setText(elements["simulated-time"], clockText(view.time - origin));
  setText(elements.play, {
    ready: "Run test", playing: "Pause", paused: "Resume", complete: automated ? "Replay test" : "Run test",
  }[mode]);
  elements.step.disabled = elements["step-ms"].disabled = mode === "complete";
  for (const button of floorButtons) {
    button.disabled = view.state !== "IDLE" || model.hasWork;
    button.dataset.target = String(Number(button.dataset.floor) === view.targetFloor);
  }
  renderVerdict(view);
  renderLog();
  renderScope(view);
}

for (const button of cases) button.addEventListener("click", () => selectTest(button.dataset.test, true));
for (const button of floorButtons) {
  button.addEventListener("click", () => {
    if (!model.press(Number(button.dataset.floor))) return;
    automated = false;
    armed = false;
    startPlayback();
  });
}
for (const button of scopeButtons) {
  button.addEventListener("click", () => {
    selectScope(button.dataset.scope);
    renderScope(model.snapshot());
  });
}

elements.play.addEventListener("click", () => {
  if (mode === "playing") {
    cancelPlayback();
    mode = "paused";
    render();
    return;
  }
  if (mode === "complete") selectTest(selected);
  startTest();
  startPlayback();
});
elements.step.addEventListener("click", () => step(true));
elements["step-ms"].addEventListener("click", () => step(false));
elements.restart.addEventListener("click", () => selectTest(selected));
elements["sensor-mode"].addEventListener("change", () => {
  model.setS2Mode(elements["sensor-mode"].value);
  if (model.state === "IDLE" && model.sensors.every((bit) => bit === 0)) {
    model.advance(1);
    if (model.state === "FAULT") finish();
  }
  render();
});
elements.reset.addEventListener("click", () => {
  model.reset();
  automated = false;
  armed = false;
  startPlayback();
});
elements.events.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-time]");
  if (button) setCursor(Number(button.dataset.time), Number(button.dataset.event));
});
elements.cursor.addEventListener("input", () => setCursor(Number(elements.cursor.value)));
elements.trace.addEventListener("pointerdown", (event) => setCursor(cursorFromPointer(elements.trace, event, plot)));
elements["scope-live"].addEventListener("click", () => setCursor(null));

if (document.fullscreenEnabled) {
  elements.fullscreen.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setText(elements.announcement, "Full screen is unavailable in this browser.");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    setText(elements.fullscreen, document.fullscreenElement ? "Exit full screen" : "Full screen");
  });
} else {
  elements.fullscreen.hidden = true;
}

const requested = new URLSearchParams(location.search).get("test");
selectTest(Object.hasOwn(scenarios, requested) ? requested : "up");
new ResizeObserver(() => renderScope(model.snapshot())).observe(elements.trace);
