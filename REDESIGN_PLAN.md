# Redesign Plan: 8051 Elevator Control (deck + site)

Hand this file to the implementing agent. Work through Part A (deck) first, then Part B (site).

## 0. Diagnosis (why the current version fails)

The current deck is visually clean, but it is a datasheet lecture, not a project presentation.

| Problem | Evidence | Fix |
|---|---|---|
| Wrong structure | 9 of 21 slides teach generic 8051 theory before the project appears; no title slide with team, no objectives, components, flowchart, code, applications, conclusion, references, or "Thank you" | Standard college project flow (Part A.2) |
| Too low-level | SFR addresses (90h, A8h, C8h), `MOV A,@R0`, PSW/DPTR/SP, UART 8N1 bit frame, preload `FC18h`, 5-row L293D truth table | Keep in speaker notes and backup slides only |
| Unreadable on a projector | 190 text runs at 11 pt; tiny uppercase monospace labels on every slide | Minimum 14 pt, body 20 pt or more (Part A.3) |
| Repetitive | Slides 16 to 21 are six near-identical "browser test" slides | One results table + one demo slide |
| Not editable | 30 to 95 loose shapes per slide; tables built from text boxes | Native PowerPoint tables, fewer and larger shapes |
| No firmware | The repo has a JavaScript simulator only; no 8051 C or assembly code exists | Add `firmware/elevator.c` and one code slide (examiners will ask for it) |
| Off-topic content | Slide 6 (switch-to-LED teaching circuit) and the UART half of slide 8 are not used by the project | Delete |

The site's logic is solid (`node --test tests/elevator-controller.test.mjs`: 18/18 pass). Its problem is the same: a dense engineer's workbench, full of jargon, that does not work as a live demo in front of a class.

## 1. Inputs needed from the user (use placeholders until given)

- Team member names and roll numbers, guide name, college and department name, date → placeholders `[Name 1]`, `[Guide]`, `[College]`, `[Date]`.
- Time limit. The plan below assumes 12 to 15 minutes. If the limit is 10 minutes, drop slides 2, 7 and 14.
- Was physical hardware built? If yes, add a "Hardware Prototype" photo slide after slide 8 and rename slide 13 to "Hardware & Simulation Results". If no, keep everything framed as "design + simulation". Never imply hardware exists when it does not.
- Does the college require its own template? If yes, apply these rules inside that template.

## Part A: PowerPoint deck

### A.1 Build process (required)

1. Write `tools/build_deck.py` using python-pptx. It outputs `8051-Elevator-Control.pptx` at the repo root. Commit the script so the deck can be rebuilt and edited.
2. Reuse the existing drawings (chip, H-bridge, block diagram, state machine, waveforms) by porting them into the script; enlarge their labels to meet A.3.
3. Use native PowerPoint tables (`shapes.add_table`) for every table. Use grouped native shapes for diagrams. Target 30 or fewer shapes per slide.
4. Also export `docs/8051-Elevator-Control.pdf` (LibreOffice: `soffice --headless --convert-to pdf`). The PDF is the backup for college PCs that lack the fonts or a recent PowerPoint version.
5. Self-check in the build script: assert every text run is 14 pt or larger, except the footer (12 pt). Fail the build otherwise.
6. Visual QA: render every slide to PNG (`pdftoppm -r 80`) and inspect each one for overflow, overlap and clipped text before finishing.

### A.2 Slide list (18 main + 6 backup)

Title style: a short topic title that an examiner can scan ("Block Diagram"), plus one plain-language takeaway line under it.

| # | Title | On-slide content | Visual | Source in current deck |
|---|---|---|---|---|
| 1 | Two-Floor Elevator Control Using the 8051 Microcontroller | Subtitle: "AT89S52 · L293D motor driver · floor limit-switch feedback". Presented by `[Name 1 (Roll)]`, `[Name 2 (Roll)]`... Guide: `[Prof. Name]`. `[Dept. of ECE, College]` · BT-EC-ES701 Embedded System · `[Date]` | Dark background; existing chip drawing at right, smaller | Slide 1 (rewrite) |
| 2 | Outline | Introduction · The 8051 · System Design · Working · Results & Demo · Conclusion | Numbered list, 6 items | New |
| 3 | Introduction & Objectives | Left, 2 lines: "An elevator controller must move the car to the requested floor, stop exactly at that floor, and stop safely if a sensor fails." Right, objectives: 1) Read floor-call buttons 2) Drive a DC motor up or down through the L293D 3) Stop using floor limit switches 4) Detect faults and cut motor power | Simple elevator icon built from shapes | New |
| 4 | AT89S52 at a Glance | 6 stat tiles: 8-bit CPU · 8 KB Flash · 256 B RAM · 32 I/O pins (4 ports) · 3 timers · 12 MHz crystal. Bottom line: "Why the 8051: low cost, simple bit-level I/O, enough for a two-floor model." | Tiles + small 4-port chip sketch | Slides 1, 2, 9 merged |
| 5 | 8051 Features Used in This Project | 3 cards, at most 2 lines each. **GPIO ports**: P3 reads buttons and floor switches; P1 controls the motor driver. **Timer 2**: generates a 1 ms tick. **Interrupt**: the Timer 2 ISR counts time for debounce and timeout | 3 cards | Slides 5, 7, 8 merged |
| 6 | System Block Diagram | Floor buttons B1, B2 → AT89S52 → L293D → DC motor → Elevator car; floor limit switches S1, S2 → back to AT89S52 (arrow labelled "position feedback"); AT89S52 → floor indicator (LED); 5 V logic supply + motor supply | Large boxes, 18 pt labels | Slide 10 (enlarge, add indicator and power blocks) |
| 7 | Components Used | Native table, Component / Role: AT89S52 (controller), 12 MHz crystal + 2 × 33 pF (clock), reset circuit (RC + switch), L293D (motor driver), DC geared motor (moves car), push buttons B1, B2 (floor calls), limit switches S1, S2 (floor detection), 74HCT14 (inverter for EN), LEDs (floor indicator), 7805 (5 V regulator) | Table | New |
| 8 | Circuit Connections | Left, inputs on Port 3: B1 → P3.4, B2 → P3.5, S1 → P3.2, S2 → P3.3. Note: "Active-low: pressed or closed = 0, using pull-ups." Right, outputs on Port 1: P1.3 → IN1, P1.4 → IN2, P1.2 → inverter → EN. Callout: "At reset all port pins are 1, so EN = 0 and the motor stays off at power-up: a safe start." | Two-column pin map, or a simplified schematic if it stays readable | Slides 11, 12 merged |
| 9 | Motor Direction with the L293D | Table with 3 rows: **Up**: IN1 1, IN2 0, EN 1 · **Down**: IN1 0, IN2 1, EN 1 · **Stop**: IN1 X, IN2 X, EN 0. One line: "Swapping IN1 and IN2 reverses the motor voltage." | Existing two H-bridge drawings, enlarged | Slide 13 (drop the two "equal levels" rows) |
| 10 | Working: Flowchart | Start → Initialize ports and Timer 2 → Read S1, S2 → "Exactly one switch closed?" (No → FAULT: motor off) → Store current floor → Wait for a button (20 ms debounce) → "Target = current?" (Yes → back to wait) → Set direction, enable motor → "Target switch closed?" (Yes → motor off, update indicator → back to wait) → "4 s elapsed?" (Yes → FAULT; No → keep checking) | Native flowchart shapes (ovals, rectangles, diamonds), two-column snake layout so it fits | New; replaces the state machine in the main deck |
| 11 | Timing & Safety | 4 tiles: **1 ms** tick (Timer 2) · **20 ms** debounce (ignores button bounce) · **2 s** normal trip · **4 s** timeout → motor off + FAULT. Line below: "Both floor switches closed at once is impossible, so the controller treats it as a fault." | Tiles; optional small debounce waveform | Slides 15, 17, 21 merged |
| 12 | Firmware (Embedded C) | 15 to 20 lines of the main loop from `firmware/elevator.c`, 16 pt or larger, 2 to 3 key lines highlighted. Caption: "Full code: firmware/elevator.c (SDCC / Keil C51)" | Dark code panel | New (see A.4) |
| 13 | Simulation Results | Left: simulator screenshot taken mid-trip. Right, native table: # · Test · Expected · Result: 1 Power-on: Floor 1 detected, motor off ✓ · 2 Button debounce: one request after 20 ms ✓ · 3 Floor 1 → 2: stops when S2 closes ✓ · 4 Floor 2 → 1: motor reverses, stops at S1 ✓ · 5 Same-floor call: motor stays off ✓ · 6 Sensor failure: motor off at 4 s, FAULT ✓ | Screenshot + table | Slides 16 to 21 merged |
| 14 | Live Demo | Big URL `pushkar1887.github.io/clg_es_ppt` + QR code. Demo script: "Call Floor 2 → watch it stop at S2 → simulate sensor failure → watch the 4 s timeout" | QR code (python `qrcode` package; install it) | New |
| 15 | Applications & Future Scope | Applications: building lifts (scaled model), goods lifts and dumbwaiters, car-parking lifts, automated storage. Future scope: more floors with keypad + 7-segment display, door motor + obstruction sensor, PWM for smooth start and stop, overload sensor, IoT monitoring | Two columns | New |
| 16 | Conclusion | 3 bullets: the 8051 reliably controls direction and stopping using limit-switch feedback · Timer 2 gives accurate debounce and timeout · Fault handling keeps the motor off whenever the position is uncertain | Bullets | New |
| 17 | References | IEEE style. Keep the current datasheet sources (Microchip AT89S52, TI L293D, TI 74HCT14) and add textbooks: M. A. Mazidi, J. G. Mazidi, R. D. McKinlay, *The 8051 Microcontroller and Embedded Systems Using Assembly and C*, Pearson; K. J. Ayala, *The 8051 Microcontroller*, Cengage. Verify edition and year before finalizing | List, 16 pt | Speaker notes of current deck |
| 18 | Thank You · Questions? | Team names repeated, site URL | Dark background | New |

Backup slides go after slide 18, each titled "Backup: ..." and used only to answer viva questions. Reuse the existing slides with fonts fixed to the A.3 minimums:

| B# | Title | Current slide |
|---|---|---|
| B1 | Registers & an 8-bit Addition (255 + 1 → carry) | 3 |
| B2 | Memory Map: Code, RAM, SFRs | 4 |
| B3 | Timer 2 Reload Calculation (65,536 − 1,000 = FC18h) and ISR | 15 + interrupt half of 8 |
| B4 | Debounce Waveform | 17 |
| B5 | Firmware State Machine | 14 |
| B6 | 8051 vs PIC18 vs Arm Cortex-M0 | 9 |

Delete: slide 6 (LED teaching circuit) and the UART frame from slide 8.

### A.3 Design rules

- 16:9. Keep the current palette: dark `#172620`, accent `#006553`, accent-soft `#e0f0e9`, page `#f2f4f1`, ink `#172220`, subtle `#53635e`, fault amber `#873f11` / `#f8ebd8`. Dark background for slides 1, 14 and 18 only; light for the rest.
- Fonts: Arial for text. Consolas (fall back to Courier New) only for pin names and code.
- Sizes: title 36 to 40 pt; takeaway line 20 to 22 pt; body 20 to 24 pt; table text 16 pt or more; diagram labels 14 pt or more; code 16 pt or more; footer 12 pt. Nothing else below 14 pt.
- At most 6 bullets per slide and roughly 40 words of on-slide text. One idea per slide.
- Remove the tiny uppercase monospace "kicker" labels from every slide body. Keep at most the section tag at the top.
- Footer: `[Team / College short name]` · BT-EC-ES701 · slide number.
- Speaker notes: 3 to 5 short plain-language talking points per slide. Move the datasheet-level detail from the current notes into the backup slides' notes.

### A.4 Firmware file (needed for slide 12)

- Create `firmware/elevator.c` in 8051 Embedded C (SDCC syntax, with a note on the Keil equivalent). Mirror `docs/controller.mjs` exactly: same pins, same states (STARTUP, IDLE, MOVING, FAULT), Timer 2 auto-reload 1 ms tick, 20 ms debounce, 4 s timeout, P1.2 high = drive disabled.
- Verify that it compiles: `apt-get install -y sdcc && sdcc -mmcs51 firmware/elevator.c`. Do not put uncompiled code on a slide.
- The slide shows only the main loop; the file holds the full program.

## Part B: Website (`docs/`)

Goal: a live demo that works on a projector at 1366 × 768 without scrolling, in plain language by default, with the current engineering detail one click away.

### B.1 Constraints

- Do not change `docs/controller.mjs`, `docs/scenarios.mjs` logic or `docs/scope.mjs` behavior. This is a UI-only change.
- `node --test tests/elevator-controller.test.mjs` must stay at 18/18 passing. (Note: `node --test tests/` fails because of how Node resolves a directory; document the correct command in the README.)
- No new framework or dependency. Plain HTML, CSS and ES modules as now.
- Bump the cache-busting query `?v=2` → `?v=3` on every changed asset.

### B.2 Changes

1. **Two views with a header toggle: "Demo" (default) and "Engineer".** Implement as `data-view` on `<body>` plus CSS that hides `.engineer-only` blocks. The Engineer view is the current workbench, unchanged.
2. **Demo view layout:**
   - Left: a large elevator shaft (about 60 vh), big F1 and F2 labels, doors that open on arrival and close before moving (CSS transition only).
   - Right: a large floor display in 7-segment style; two big call buttons "Floor 1" and "Floor 2"; a motor indicator (▲ UP / ▼ DOWN / ■ STOPPED); four input lamps B1, B2, S1, S2 that light when the signal is active (logic 0); one toggle "Simulate Floor 2 sensor failure" (maps to the existing `sensor-mode = open`); a Reset button.
   - One status sentence in plain English, e.g. "Moving up to Floor 2…", "Arrived at Floor 2. Motor off.", "Fault: Floor 2 sensor did not respond within 4 s. Motor stopped. Press Reset."
3. **Plain-English event log in Demo view:** map each event kind to a sentence. Keep the technical wording ("1A / 2A = 1 / 0. EN = 1.") in Engineer view.
4. **Match the slides:** name the scenarios "Test 1 · Power on" to "Test 6 · Sensor failure", in the same order as the slide 13 table, so the presenter can say "this is test 3 from the slide".
5. **Header:** project title + `[Team names]` line; buttons "Slides (PDF)" → `docs/8051-Elevator-Control.pdf`, "PowerPoint", "Full screen".
6. **Engineer-only:** move the logic analyzer, cursor, "Step 1 ms", "Next event", speed selector (including 0.03×), fault-injection dropdown and the model-timing list into Engineer view.
7. **Presenter shortcuts (optional):** `1` / `2` call floors, `Space` run or pause, `R` reset, `F` full screen. Show them in a small hint line.

### B.3 Site QA

- Playwright screenshots at 1366 × 768, 1920 × 1080 and 390 × 844 (phone), for both views, idle and mid-trip. Demo view must fit 1366 × 768 with no page scroll.
- No console errors.
- Run all 6 scenarios in both views; each must reach its "Pass" verdict.
- Reuse the 1366 × 768 mid-trip screenshot on slide 13.

## Part C: Repo housekeeping

- README: one-paragraph project summary, links to the live site, the PPTX and the PDF, plus the build and test commands (`python tools/build_deck.py`, `node --test tests/elevator-controller.test.mjs`, `sdcc -mmcs51 firmware/elevator.c`).

## Acceptance checklist

- [ ] 18 main slides + 6 backup; structure matches A.2
- [ ] Build script passes its font-size check; no text run below 14 pt except the footer
- [ ] Every slide inspected as PNG: no overflow, overlap or clipping
- [ ] All placeholders `[...]` listed for the user to fill in, or filled in
- [ ] `firmware/elevator.c` compiles with SDCC; slide 12 code matches the file
- [ ] PDF export present in `docs/`
- [ ] Site: Demo view is the default, fits 1366 × 768, plain-English status; Engineer view unchanged
- [ ] 18/18 tests pass; no console errors
- [ ] Slide 13 test names match the site's test names
