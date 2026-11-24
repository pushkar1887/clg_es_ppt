import assert from "node:assert/strict";
import test from "node:test";
import { ElevatorController } from "../docs/controller.mjs";

function readyAt(floor = 1, s2Open = false) {
  const model = new ElevatorController({ floor, s2Open });
  model.advance(250);
  return model;
}

test("reset holds the bridge off until a floor is confirmed", () => {
  const model = new ElevatorController({ floor: 1 });
  assert.equal(model.snapshot().enable, 0);
  assert.equal(model.snapshot().state, "STARTUP");
  assert.equal(model.snapshot().currentFloor, null);
  model.advance(250);
  assert.equal(model.snapshot().currentFloor, 1);
  assert.equal(model.snapshot().state, "IDLE");
  assert.deepEqual([model.snapshot().s1, model.snapshot().s2], [0, 1]);
  assert.equal(model.snapshot().enable, 0);
});

test("the bounces produce one request only after twenty stable milliseconds", () => {
  const model = readyAt();
  assert.equal(model.press(2), true);
  model.advance(27);
  assert.equal(model.events.filter((event) => event.kind === "request").length, 0);
  assert.equal(model.snapshot().enable, 0);
  model.advance(1);
  assert.equal(model.events.filter((event) => event.kind === "request").length, 1);
  assert.equal(model.snapshot().targetFloor, 2);
  model.advance(140);
  assert.equal(model.events.filter((event) => event.kind === "request").length, 1);
  const edges = model.trace
    .filter((sample, index, trace) => index > 0 && sample.b2 !== trace[index - 1].b2)
    .map(({ time, b2 }) => [time, b2]);
  assert.deepEqual(edges, [[251, 0], [252, 1], [254, 0], [256, 1], [258, 0], [338, 1]]);
});

test("upward drive ends on low S2 at the physical top", () => {
  const model = readyAt();
  model.press(2);
  model.advance(28);
  assert.deepEqual([model.snapshot().a1, model.snapshot().a2, model.snapshot().enable], [1, 0, 1]);
  model.advance(1_999);
  assert.deepEqual([model.snapshot().s1, model.snapshot().s2], [1, 1]);
  assert.equal(model.snapshot().currentFloor, 1);
  model.advance(1);
  assert.equal(model.snapshot().position, 1);
  assert.equal(model.snapshot().s2, 0);
  assert.equal(model.snapshot().currentFloor, 2);
  assert.equal(model.snapshot().enable, 0);
  assert.equal(model.snapshot().state, "IDLE");
});

test("a downward request reverses the bridge and stops at S1", () => {
  const model = readyAt(2);
  model.press(1);
  model.advance(28);
  assert.deepEqual([model.snapshot().a1, model.snapshot().a2, model.snapshot().enable], [0, 1, 1]);
  model.advance(2_000);
  assert.equal(model.snapshot().position, 0);
  assert.equal(model.snapshot().s1, 0);
  assert.equal(model.snapshot().currentFloor, 1);
  assert.equal(model.snapshot().enable, 0);
});

test("a same-floor request produces no motor enable edge", () => {
  const model = readyAt();
  model.press(1);
  model.advance(150);
  assert.equal(model.snapshot().position, 0);
  assert.equal(model.snapshot().targetFloor, null);
  assert.equal(model.snapshot().state, "IDLE");
  assert.ok(model.events.some((event) => event.kind === "same"));
  assert.ok(model.trace.every((sample) => sample.enable === 0));
});

test("the release must settle before the next press is accepted", () => {
  const model = readyAt();
  model.press(1);
  model.advance(88);
  assert.equal(model.hasWork, true);
  assert.equal(model.press(1), false);
  model.advance(20);
  assert.equal(model.hasWork, false);
  assert.equal(model.press(1), true);
  model.advance(28);
  assert.equal(model.events.filter((event) => event.kind === "same").length, 2);
});

test("opening S2 forces a timeout at four seconds with arrival unconfirmed", () => {
  const model = readyAt(1, true);
  model.press(2);
  model.advance(28 + 3_999);
  assert.equal(model.snapshot().position, 1);
  assert.equal(model.snapshot().s2, 1);
  assert.equal(model.snapshot().enable, 1);
  model.advance(1);
  assert.equal(model.snapshot().enable, 0);
  assert.equal(model.snapshot().state, "FAULT");
  assert.equal(model.snapshot().fault, "timeout");
  assert.equal(model.snapshot().elapsed, 4_000);
  assert.equal(model.snapshot().currentFloor, 1);
  assert.equal(model.press(1), false);
});

test("reset during motion removes drive and faults on an unknown position", () => {
  const model = readyAt();
  model.press(2);
  model.advance(1_028);
  assert.equal(model.snapshot().position, 0.5);
  model.reset();
  assert.equal(model.snapshot().enable, 0);
  model.advance(250);
  assert.equal(model.snapshot().position, 0.5);
  assert.equal(model.snapshot().state, "FAULT");
  assert.equal(model.snapshot().fault, "unknown position");
});

test("restoring S2 before the deadline lets the same trip finish", () => {
  const model = readyAt(1, true);
  model.press(2);
  model.advance(28 + 2_500);
  assert.equal(model.snapshot().enable, 1);
  assert.equal(model.snapshot().s2, 1);
  model.setS2Open(false);
  model.advance(1);
  assert.equal(model.snapshot().state, "IDLE");
  assert.equal(model.snapshot().s2, 0);
  assert.equal(model.snapshot().currentFloor, 2);
});

test("starting with S2 shorted at Floor 1 faults at the end of startup", () => {
  const model = new ElevatorController({ floor: 1, s2Open: true, s2Mode: "short" });
  const { s1, s2, s2Mode, s2Open } = model.snapshot();
  assert.deepEqual([s1, s2, s2Mode, s2Open], [0, 0, "short", false]);
  model.advance(249);
  assert.equal(model.snapshot().state, "STARTUP");
  model.advance(1);
  const { state, fault, enable } = model.snapshot();
  assert.deepEqual([state, fault, enable], ["FAULT", "contradictory sensors", 0]);
});

test("changing the S2 mode updates the input and records the change", () => {
  const model = readyAt(2);
  assert.equal(model.snapshot().s2Mode, "normal");
  assert.equal(model.snapshot().s2, 0);

  model.setS2Mode("open");
  assert.equal(model.snapshot().s2, 1);
  assert.equal(model.snapshot().s2Open, true);
  model.setS2Mode("open");

  model.setS2Mode("short");
  assert.equal(model.snapshot().s2, 0);
  assert.equal(model.snapshot().s2Open, false);

  model.setS2Open(false);
  assert.equal(model.snapshot().s2, 0);
  assert.equal(model.snapshot().s2Mode, "normal");
  const switches = model.events.filter((event) => event.kind === "switch");
  assert.deepEqual(switches.map((event) => event.time), [250, 250, 250]);
});

test("an invalid S2 mode leaves the input and event log untouched", () => {
  assert.throws(() => new ElevatorController({ s2Mode: "invalid" }), RangeError);
  const model = readyAt(2);
  const eventCount = model.events.length;
  assert.throws(() => model.setS2Mode("invalid"), RangeError);
  assert.equal(model.snapshot().s2, 0);
  assert.equal(model.snapshot().s2Mode, "normal");
  assert.equal(model.events.length, eventCount);
});

test("shorting S2 at Floor 1 latches a fault on the next idle tick", () => {
  const model = readyAt();
  model.setS2Mode("short");
  assert.equal(model.snapshot().state, "IDLE");
  assert.equal(model.hasWork, true);

  model.advance(1);
  const { time, state, fault, enable } = model.snapshot();
  assert.deepEqual([time, state, fault, enable], [251, "FAULT", "contradictory sensors", 0]);
  assert.equal(model.hasWork, false);

  model.setS2Mode("normal");
  model.advance(250);
  assert.equal(model.snapshot().state, "FAULT");
  assert.equal(model.press(2), false);

  model.reset();
  model.advance(250);
  assert.equal(model.snapshot().state, "IDLE");
  assert.equal(model.snapshot().currentFloor, 1);
});

test("startup checks the same sensor fault after a reset", () => {
  const model = readyAt();
  model.setS2Mode("short");
  model.advance(1);
  assert.equal(model.snapshot().state, "FAULT");

  model.reset();
  assert.equal(model.snapshot().s2Mode, "short");
  assert.equal(model.snapshot().s2, 0);
  model.advance(250);
  assert.equal(model.snapshot().state, "FAULT");
  assert.equal(model.snapshot().fault, "contradictory sensors");
});

test("a contradiction at the start of motion stops the bridge before the first step", () => {
  const model = readyAt();
  assert.equal(model.press(2), true);
  model.advance(28);
  assert.equal(model.snapshot().state, "MOVING");
  assert.equal(model.snapshot().position, 0);

  model.setS2Mode("short");
  model.advance(1);
  const { state, fault, enable, position } = model.snapshot();
  assert.deepEqual([state, fault, enable, position], ["FAULT", "contradictory sensors", 0, 0]);
});

test("a downward trip faults when S1 closes while S2 is shorted", () => {
  const model = readyAt(2);
  model.setS2Mode("short");
  assert.equal(model.press(1), true);
  model.advance(2_027);
  assert.equal(model.snapshot().state, "MOVING");
  assert.equal(model.snapshot().s1, 1);

  model.advance(1);
  const { state, fault, position, p12 } = model.snapshot();
  assert.deepEqual([state, fault, position, p12], ["FAULT", "contradictory sensors", 0, 1]);
});

test("P1.2 is active low in the controller snapshot", () => {
  const model = new ElevatorController();
  assert.equal(model.snapshot().p12, 1);
  model.advance(250);
  assert.equal(model.press(2), true);
  model.advance(28);
  assert.equal(model.snapshot().p12, 0);
  model.reset();
  assert.equal(model.snapshot().p12, 1);
});

test("the trace keeps bridge outputs at motion, arrival, and reset", () => {
  const model = readyAt();
  assert.equal(model.press(2), true);
  model.advance(2_028);
  assert.equal(model.press(1), true);
  model.advance(2_028);
  model.reset();

  const times = new Set([0, 278, 2_278, 2_306, 4_306]);
  const recorded = model.trace
    .filter(({ time }) => times.has(time))
    .map(({ time, a1, a2, enable, p12 }) => [time, a1, a2, enable, p12]);
  assert.deepEqual(recorded, [
    [0, 1, 1, 0, 1],
    [278, 1, 0, 1, 0],
    [2_278, 1, 0, 0, 1],
    [2_306, 0, 1, 1, 0],
    [4_306, 0, 1, 0, 1],
    [4_306, 1, 1, 0, 1],
  ]);
});
