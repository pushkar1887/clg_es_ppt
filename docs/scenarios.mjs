import { timing } from "./controller.mjs?v=2";

function atRest(view, floor) {
  return view.state === "IDLE" && view.currentFloor === floor && view.position === floor - 1 && view.enable === 0;
}

export const scenarios = Object.freeze({
  startup: {
    title: "Power on",
    detail: "Confirm Floor 1 from S1 with the drive disabled, then accept floor requests.",
    floor: 1, stop: "ready", span: 360, speed: "0.5", scope: "position",
    check: (view) => atRest(view, 1) && view.s1 === 0 && view.s2 === 1,
  },
  debounce: {
    title: "Button debounce",
    detail: "Follow the raw B2 edges until 20 ms of stable low input produces one accepted request.",
    floor: 1, target: 2, stop: "request", span: 40, speed: "0.03", scope: "buttons",
    check: (view, events) => view.targetFloor === 2 && events.filter((event) => event.kind === "request").length === 1,
  },
  up: {
    title: "Go to Floor 2",
    detail: "Drive up from Floor 1 and watch S2 confirm arrival and remove drive.",
    floor: 1, target: 2, stop: "arrival", span: 2_240, speed: "1", scope: "position",
    check: (view) => atRest(view, 2) && view.s2 === 0 && view.a1 === 1 && view.a2 === 0,
  },
  down: {
    title: "Return to Floor 1",
    detail: "Reverse the bridge polarity and use S1 to confirm the downward trip.",
    floor: 2, target: 1, stop: "arrival", span: 2_240, speed: "1", scope: "bridge",
    check: (view) => atRest(view, 1) && view.s1 === 0 && view.a1 === 0 && view.a2 === 1,
  },
  same: {
    title: "Same-floor request",
    detail: "Request Floor 1 while the car is already there. The controller completes the request with EN at zero.",
    floor: 1, target: 1, stop: "same", span: 160, speed: "0.25", scope: "position",
    check: (view, events, trace) => atRest(view, 1) && events.some((event) => event.kind === "same") &&
      trace.every((sample) => sample.enable === 0),
  },
  timeout: {
    title: "Travel timeout",
    detail: "Hold S2 open during ascent. At 4 seconds the controller removes drive and latches a fault.",
    floor: 1, target: 2, stop: "fault", span: 4_360, speed: "1", scope: "position", s2Mode: "open",
    check: (view) => view.state === "FAULT" && view.fault === "timeout" && view.elapsed === timing.timeout &&
      view.currentFloor === 1 && view.s2 === 1 && view.enable === 0,
  },
});
