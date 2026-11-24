export const timing = Object.freeze({ startup: 250, debounce: 20, travel: 2_000, timeout: 4_000 });

// Millisecond offsets for the simulated contact edges of a single press.
const contact = [[1, 0], [2, 1], [4, 0], [6, 1], [8, 0], [88, 1]];
const signals = ["s1", "s2", "b1", "b2", "enable", "accepted"];

export class ElevatorController {
  constructor({ floor = 1, s2Open = false } = {}) {
    this.time = 0;
    this.car = floor === 2 ? timing.travel : 0;
    this.s2Open = s2Open;
    this.events = [];
    this.trace = [];
    this.sequence = 0;
    this.reset();
  }

  get sensors() {
    return [Number(this.car !== 0), Number(this.car !== timing.travel || this.s2Open)];
  }

  get hasWork() {
    return this.state === "STARTUP" || this.state === "MOVING" || this.edges.length > 0 ||
      this.samples.some((sample) => sample.raw !== sample.stable);
  }

  snapshot() {
    const [s1, s2] = this.sensors;
    return {
      time: this.time,
      position: this.car / timing.travel,
      state: this.state,
      currentFloor: this.currentFloor,
      targetFloor: this.targetFloor,
      direction: this.enable ? this.direction : 0,
      elapsed: this.state === "MOVING" ? this.time - this.tripStart : this.elapsed,
      fault: this.fault,
      s2Open: this.s2Open,
      s1,
      s2,
      b1: this.buttons[0],
      b2: this.buttons[1],
      a1: this.a1,
      a2: this.a2,
      enable: this.enable,
      accepted: this.accepted,
    };
  }

  reset() {
    this.state = "STARTUP";
    this.readyAt = this.time + timing.startup;
    this.enable = 0;
    this.a1 = 1;
    this.a2 = 1;
    this.direction = 0;
    this.currentFloor = null;
    this.targetFloor = null;
    this.fault = null;
    this.elapsed = 0;
    this.edges = [];
    this.buttons = [1, 1];
    this.samples = this.buttons.map((raw) => ({ raw, stable: raw, since: this.time }));
    this.accepted = 0;
    this.#event("reset", "Controller reset", "Bridge disabled during startup.");
    this.#capture();
  }

  setS2Open(open) {
    const next = Boolean(open);
    if (this.s2Open === next) return;
    this.s2Open = next;
    this.#event(
      "switch",
      next ? "S2 held open" : "S2 restored",
      next ? "The Floor 2 input will read high." : "S2 follows the car position.",
    );
    this.#capture();
  }

  press(floor, delay = 0) {
    if (this.state !== "IDLE" || this.hasWork || (floor !== 1 && floor !== 2)) return false;
    this.edges = contact.map(([offset, value]) => ({ at: this.time + delay + offset, floor, value }));
    return true;
  }

  advance(milliseconds, stop = null) {
    const until = this.time + Math.max(0, Math.floor(milliseconds));
    while (this.time < until) {
      this.#tick();
      if (stop?.(this)) break;
    }
  }

  #tick() {
    this.time++;
    this.accepted = 0;
    while (this.edges.length && this.edges[0].at <= this.time) {
      const { floor, value } = this.edges.shift();
      this.buttons[floor - 1] = value;
    }

    if (this.state === "STARTUP" && this.time >= this.readyAt) {
      const [s1, s2] = this.sensors;
      if (s1 !== s2) {
        this.currentFloor = s1 === 0 ? 1 : 2;
        this.state = "IDLE";
        this.#event("ready", "Starting floor confirmed", "Floor " + this.currentFloor + " detected. EN = 0.");
      } else {
        this.#fault(s1 === 1 ? "unknown position" : "contradictory sensors");
      }
    }

    if (this.state === "MOVING") {
      this.car = Math.min(timing.travel, Math.max(0, this.car + this.direction));
      const [s1, s2] = this.sensors;
      if (s1 === 0 && s2 === 0) {
        this.#fault("contradictory sensors");
      } else if ((this.targetFloor === 1 ? s1 : s2) === 0) {
        this.#arrive();
      } else if (this.time - this.tripStart >= timing.timeout) {
        this.#fault("timeout");
      }
    }

    for (let index = 0; index < 2; index++) {
      const raw = this.buttons[index];
      const sample = this.samples[index];
      if (raw !== sample.raw) {
        sample.raw = raw;
        sample.since = this.time;
      }
      if (raw !== sample.stable && this.time - sample.since >= timing.debounce) {
        sample.stable = raw;
        if (raw === 0 && this.state === "IDLE") this.#request(index + 1);
      }
    }
    this.#capture();
  }

  #request(floor) {
    this.accepted = 1;
    this.#event("request", "Floor " + floor + " request accepted", "The button was stable low for 20 ms.");
    if (floor === this.currentFloor) {
      this.elapsed = 0;
      this.#event("same", "Request completed in place", "Target equals the current floor. EN = 0.");
      return;
    }
    this.targetFloor = floor;
    this.direction = floor > this.currentFloor ? 1 : -1;
    this.a1 = Number(this.direction > 0);
    this.a2 = Number(this.direction < 0);
    this.tripStart = this.time;
    this.elapsed = 0;
    this.state = "MOVING";
    this.enable = 1;
    this.#event("move", this.direction === 1 ? "Drive up" : "Drive down", "1A / 2A = " + this.a1 + " / " + this.a2 + ". EN = 1.");
  }

  #arrive() {
    this.elapsed = this.time - this.tripStart;
    this.enable = 0;
    this.currentFloor = this.targetFloor;
    this.targetFloor = null;
    this.state = "IDLE";
    this.#event("arrival", "Floor " + this.currentFloor + " confirmed", "S" + this.currentFloor + " fell low. EN = 0.");
  }

  #fault(reason) {
    if (this.state === "MOVING") this.elapsed = this.time - this.tripStart;
    this.enable = 0;
    this.state = "FAULT";
    this.fault = reason;
    const detail = reason === "timeout" ? "Target sensor stayed high for 4 s." : "The input pair cannot confirm a floor.";
    this.#event("fault", reason === "timeout" ? "Travel deadline reached" : "Position check failed", detail + " EN = 0.");
  }

  #event(kind, title, detail) {
    this.events.push({ id: ++this.sequence, time: this.time, kind, title, detail });
    if (this.events.length > 48) this.events.shift();
  }

  #capture() {
    const [s1, s2] = this.sensors;
    const sample = { time: this.time, s1, s2, b1: this.buttons[0], b2: this.buttons[1], enable: this.enable, accepted: this.accepted };
    const previous = this.trace.at(-1);
    if (!previous || signals.some((signal) => sample[signal] !== previous[signal])) this.trace.push(sample);
    if (this.trace.length > 500) this.trace.shift();
  }
}
