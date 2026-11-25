import { ElevatorController, timing } from "./controller.mjs?v=2";
import { scenarios } from "./scenarios.mjs?v=2";
import { cursorFromPointer, drawScope, groups, sampleAt, signals } from "./scope.mjs?v=2";

const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "play", "step", "step-ms", "restart", "fullscreen", "case-title", "expectation", "verdict",
  "motion", "indicator", "shaft", "car", "s1Tag", "s2Tag", "sensor-mode", "reset", "speed",
  "simulated-time", "state", "pin-b1", "pin-b2", "pin-s1", "pin-s2", "pin-a1", "pin-a2", "pin-p12",
  "enable", "current", "target", "elapsed", "scope-time", "scope-live", "trace", "cursor",
  "scope-values", "events", "announcement", "display", "big-floor", "arrow-up", "arrow-down", "status",
  "lamp-b1", "lamp-b2", "lamp-s1", "lamp-s2", "motor", "motor-text", "s2-fail", "demo-reset",
].map((id) => [id, byId(id)]));
const cases = [...document.querySelectorAll("[data-test]")];
const floorButtons = [...document.querySelectorAll("[data-floor]")];
const scopeButtons = [...document.querySelectorAll("[data-scope]")];
const machineStates = [...document.querySelectorAll("[data-machine-state]")];
const viewButtons = [...document.querySelectorAll("[data-view-option]")];
const demoView = () => document.body.dataset.view === "demo";
// Plain-language log text for the Demo view; the Engineer view keeps the controller's pin-level wording.
const plainDetail = {
  reset: "Motor held off while the floor switches are checked.",
  ready: "Exactly one floor switch is closed, so the car's position is known.",
  request: "The button stayed pressed for 20 ms, so it counts as a real press.",
  same: "The car is already at that floor, so the motor stays off.",
  move: "The 8051 switches the motor on and watches the target floor switch.",
  arrival: "The floor switch closed, so the 8051 switched the motor off.",
};
const plainSwitch = {
  "S2 restored": ["Floor 2 sensor working again", "S2 now follows the car position."],
  "S2 held open": ["Floor 2 sensor failure simulated", "S2 will never report the car's arrival."],
  "S2 shorted to ground": ["Floor 2 sensor shorted", "S2 now always reads closed."],
};
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

function plainEvent(event) {
  if (event.kind === "switch") return plainSwitch[event.title] ?? [event.title, event.detail];
  if (event.kind === "move") return ["Motor on: moving " + (event.signals.a1 ? "up" : "down"), plainDetail.move];
  if (event.kind === "fault") {
    return [event.title, event.fault === "timeout"
      ? "The floor switch never closed within 4 s, so the motor was stopped for safety."
      : "The floor switches give an impossible reading, so the motor stays off."];
  }
  return [event.title, plainDetail[event.kind] ?? event.detail];
}

function statusText(view) {
  if (view.state === "STARTUP") return "Starting up: checking the floor switches. Motor off.";
  if (view.state === "MOVING") return "Moving " + (view.direction === 1 ? "up" : "down") + " to Floor " + view.targetFloor + "…";
  if (view.state === "FAULT") {
    return view.fault === "timeout"
      ? "Fault: the Floor " + view.targetFloor + " switch did not close within 4 s. Motor stopped. Press Reset."
      : view.fault === "unknown position"
        ? "Fault: no floor switch is closed, so the position is unknown. Motor off. Press Reset."
        : "Fault: both floor switches read closed at once. Motor off. Press Reset.";
  }
  return "Stopped at Floor " + view.currentFloor + ". Press a floor button.";
}

function renderDemo(view) {
  const fault = view.state === "FAULT";
  setText(elements["big-floor"], view.currentFloor);
  elements.display.setAttribute("aria-label", "Floor indicator shows " + (view.currentFloor ?? "no floor"));
  elements.display.classList.toggle("fault", fault);
  elements["arrow-up"].classList.toggle("on", view.direction === 1);
  elements["arrow-down"].classList.toggle("on", view.direction === -1);
  setText(elements.status, statusText(view));
  elements.status.classList.toggle("fault", fault);
  for (const key of ["b1", "b2", "s1", "s2"]) {
    const lamp = elements["lamp-" + key];
    const on = view[key] === 0;
    lamp.classList.toggle("on", on);
    setText(lamp.lastElementChild, key[0] === "b" ? (on ? "pressed" : "released") : (on ? "closed" : "open"));
  }
  elements.motor.dataset.dir = String(view.direction);
  setText(elements["motor-text"], view.direction === 1 ? "On · up" : view.direction === -1 ? "On · down" : "Off");
  elements["s2-fail"].checked = view.s2Mode !== "normal";
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
    const [titleText, detailText] = demoView() ? plainEvent(event) : [event.title, event.detail];
    button.setAttribute("aria-label", titleText + " at " + clockText(offset));
    const time = document.createElement("time");
    time.dateTime = "PT" + (offset / 1_000).toFixed(3) + "S";
    time.textContent = clockText(offset);
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = titleText;
    const detail = document.createElement("p");
    detail.id = "event-detail-" + event.id;
    detail.textContent = detailText;
    button.setAttribute("aria-describedby", detail.id);
    body.append(title, detail);
    button.append(time, body);
    row.append(button);
    return row;
  });
  elements.events.replaceChildren(...rows);
  updateCursorSelection();
  if (focusedId) elements.events.querySelector('[data-event="' + focusedId + '"]')?.focus({ preventScroll: true });
  if (events.length) setText(elements.announcement, (demoView() ? plainEvent(events[0]) : [events[0].title, events[0].detail]).join(". "));
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
  elements.car.classList.toggle("open", view.state === "IDLE" && view.direction === 0 && view.position % 1 === 0);
  elements.shaft.setAttribute("aria-label", "Car " + location);
  const motion = view.direction === 1 ? "Moving up" : view.direction === -1 ? "Moving down" : "Stopped";
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
  renderDemo(view);
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
function setView(name, changeURL = false) {
  document.body.dataset.view = name;
  for (const button of viewButtons) setPressed(button, button.dataset.viewOption === name);
  logVersion = null;
  if (changeURL) {
    const url = new URL(location.href);
    if (name === "demo") url.searchParams.delete("view");
    else url.searchParams.set("view", name);
    history.replaceState(null, "", url);
  }
  if (model) render();
}

function changeS2Mode(mode) {
  model.setS2Mode(mode);
  if (model.state === "IDLE" && model.sensors.every((bit) => bit === 0)) {
    model.advance(1);
    if (model.state === "FAULT") finish();
  }
  render();
}

function resetController() {
  model.reset();
  automated = false;
  armed = false;
  startPlayback();
}

for (const button of viewButtons) button.addEventListener("click", () => setView(button.dataset.viewOption, true));
elements["sensor-mode"].addEventListener("change", () => changeS2Mode(elements["sensor-mode"].value));
elements["s2-fail"].addEventListener("change", () => changeS2Mode(elements["s2-fail"].checked ? "open" : "normal"));
elements.reset.addEventListener("click", resetController);
elements["demo-reset"].addEventListener("click", resetController);
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

const params = new URLSearchParams(location.search);
setView(params.get("view") === "engineer" ? "engineer" : "demo");
const requested = params.get("test");
selectTest(Object.hasOwn(scenarios, requested) ? requested : "up");
new ResizeObserver(() => renderScope(model.snapshot())).observe(elements.trace);
