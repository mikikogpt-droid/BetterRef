# BetterRef

## CLI Quick Start

BetterRef includes local Node.js CLI tools for immediate screenshot-to-reference checks.

```bash
npm install
npx betterref-diff --ref reference.png --actual screenshot.png --out .betterref
```

Capture a local page and diff it in one command when Playwright is installed:

```bash
npm install -D playwright
npx playwright install chromium
npx betterref-capture --url http://127.0.0.1:3000/ --ref reference.png --out .betterref --viewport 1440x900
```

Outputs:

- `.betterref/report.json` - thresholds, metrics, pass/revise status, and visual verdict data
- `.betterref/diff.png` - pixel hotspot image for the next UI patch

Exit code `0` means the configured thresholds passed. Exit code `1` means revise. Exit code `2` means invalid usage or missing optional tooling.

## ภาษาไทย

BetterRef คือ skill สำหรับงานที่ต้องทำภาพหรือ UI ให้ตรงกับภาพอ้างอิงมากที่สุด เช่น UI screenshot, mockup, dashboard, hero visual, landing/app redesign หรือ visual QA แบบ screenshot-to-reference

เป้าหมายหลักคือ **reference fidelity สูงสุด** ไม่ใช่แค่โทนคล้าย และไม่ใช่การออกแบบใหม่ตามใจ ถ้าผู้ใช้บอกว่าต้องดีกว่า reference หมายถึง composition/state เดิม แต่ polish, readability, asset quality, typography และความเรียบร้อยต้องเท่าหรือดีกว่า

### ใช้เมื่อไหร่

- ผู้ใช้แนบภาพอ้างอิงและขอให้ทำให้เหมือน
- ต้องแก้ UI ที่ยังไม่เหมือน reference
- ต้องทำ hero/image/visual asset ที่ CSS หรือ SVG เลียนแบบได้ไม่พอ
- ต้องตรวจงานด้วย screenshot เทียบ reference
- ต้องทำงาน pixel-perfect หรือ premium visual polish

### หลักการสำคัญ

- ใช้ reference image เป็น source of truth
- ระบุให้ชัดว่าภาพไหนคือ current และภาพไหนคือ reference
- ทำ state ให้เหมือน reference ก่อนเทียบ: viewport, zoom, route, tab, scroll, workspace/path, folder, data state
- วัด layout ก่อนตัดสิน: topbar, rail, sidebar, main workspace, right panel, hero, search card, KPI, status bar
- ใช้ `imagegen` ได้เต็มที่กับ hero, glass/3D/cinematic visual, texture, raster asset และภาพ premium
- เริ่มจากเครื่องมือ/asset/font/dependency ที่มีในเครื่องหรือใน project ก่อน ถ้ายังปิด visual gap ไม่ได้ ให้หา สร้าง หรือติดตั้งเครื่องมือเสริมแบบจำกัด scope
- ใช้ HTML/CSS/SVG กับโครง UI ที่ต้อง deterministic เช่น panel, button, tab, card, form, layout
- จัดการ typography เป็น requirement หลัก: font family, Thai glyph, fallback, weight, line-height, text box, line break, KPI number
- ถ่าย screenshot จริงที่ viewport/state เดียวกับ reference แล้วทำ Visual Verdict ก่อนบอกว่างานเสร็จ

### 14 ข้อบังคับของ BetterRef

ก่อนตัดสินว่างาน reference-matching เสร็จ ต้องเช็กครบทั้ง 14 ข้อนี้:

1. ระบุให้ชัดว่า current คือภาพไหน และ reference คือภาพไหน
2. ทำ same-state ก่อนเทียบ: viewport, zoom, path, route, tab, scroll, folder, data state
3. วัด layout จริง ไม่ดูจากความรู้สึก: sidebar, main, right panel, hero, search card, KPI, status bar
4. เช็ก typography เป็นเรื่องหลัก: font family, Thai glyph, weight, line-height, line break, KPI number
5. โฟกัสจุดใหญ่ก่อน เช่น title, chips, KPI, hero, clipping, scrollbar
6. ใช้ `imagegen` ได้เต็มที่เมื่อ visual เป็น glass/3D/cinematic/raster ไม่ควรฝืนวาด CSS/SVG
7. ทำ tool inventory ก่อน: browser tool, screenshot, DOM measure, pixel sampler, image processing, fonts, icons, dependencies
8. map ทุก visual gap กับเครื่องมือหรือ asset workflow ที่จะใช้แก้
9. ถ้าเครื่องมือในเครื่องไม่พอ ต้องหา สร้าง หรือติดตั้งเครื่องมือเสริมแบบ scoped เช่น pixel diff, SSIM, font tools, background removal, helper script
10. ห้ามลดคุณภาพเพราะ "ไม่มีเครื่องมือ" ถ้ายังมีทางหา สร้าง ติดตั้ง หรือ script ได้
11. ทุก escalation ต้องบอกว่าแก้ gap อะไร และต้อง verify ด้วย screenshot ใหม่
12. ต้องมี Visual Verdict: score, pass/revise/fail, hard fail, differences, next edits
13. ถ้ามี hard fail ห้ามบอกว่า pass ต่อให้คะแนนจากความรู้สึกสูง
14. Final report ต้องบอก tool inventory/escalation ที่ใช้ พร้อม visual gap ที่แต่ละตัวแก้

### การยกระดับเครื่องมือ

BetterRef ต้องไม่ลดคุณภาพเพราะเครื่องมือเดิมไม่พอ:

- ทำ inventory ก่อน: browser/screenshot tool, DOM measurement, pixel sampler, image processing, `imagegen`, local assets, installed fonts, icon libraries, project dependencies
- map visual gap กับเครื่องมือ เช่น layout เพี้ยน, font/Thai glyph เพี้ยน, hero asset crop ผิด, มี bitmap edge, KPI ถูกตัด, scrollbar เกิน, สี/เงาไม่ตรง
- ถ้าเครื่องมือในเครื่องยังไม่พอ ให้ใช้ `imagegen`, หา asset/font/icon/library ที่เหมาะ, เขียน helper script, หรือติดตั้ง package แบบ temporary/project-local
- ทุก escalation ต้องบอกว่าแก้ gap อะไร และต้อง verify ด้วย screenshot ใหม่
- หลีกเลี่ยง global install หรือ runtime dependency ใหม่ถ้าไม่จำเป็นต่อ project

### Hard Fail Gates

ถ้ามีข้อใดข้อหนึ่ง ห้ามบอกว่า pass:

- current/reference สลับกันหรือไม่ชัด
- state ไม่ตรง reference เช่น path/folder/tab/route/scroll/viewport ผิด
- content ถูกตัด ถูกบัง ซ้อน หรือ bottom/status bar บัง
- scrollbar แปลก ๆ หรือ overflow ที่ reference ไม่มี
- title ที่ reference เป็นบรรทัดเดียว แต่ของจริงแตกหลายบรรทัด
- font fallback ผิด, Thai glyph ไม่เหมือน, line-height เพี้ยน, text rhythm เปลี่ยน
- hero/raster asset เห็นกรอบ bitmap, crop ผิด, lighting/depth ต่ำกว่า reference
- macro layout ผิดสัดส่วน เช่น sidebar, main, right panel, search card, KPI
- right/side panel ชนกันหรือ spacing แคบกว่า reference
- icon ดูเป็น placeholder หรือ style ไม่ตรง
- งานเหมือนแค่สีหรือ mood แต่ spacing/composition/hierarchy ไม่เหมือน
- ไม่มี screenshot สดจากแอปจริงก่อนตัดสิน

### Scoring

- `<80` = fail
- `80-89` = revise
- `90-94` = close but not complete
- `95-97` = acceptable match ถ้าไม่มี hard fail
- `98+` = near pixel-perfect

ถ้ามี hard fail ให้ถือว่า fail/revise ไม่ว่าคะแนนจากความรู้สึกจะสูงแค่ไหน

### รายงานก่อนจบงาน

ก่อนบอกว่างานเสร็จ ต้องรายงาน:

- reference source และ current screenshot source
- viewport/device scale และ same-state ผ่านหรือไม่
- Visual Verdict: score, verdict, same_state, hard_fail_present
- top differences
- top next edits ถ้ายังไม่ผ่าน
- tool inventory และ escalation ที่ใช้ พร้อม visual gap ที่แต่ละตัวแก้
- verification ที่ทำ เช่น app run, screenshot path, pixel/overlay check, smoke test

### ไฟล์หลัก

- `SKILL.md` - workflow หลักสำหรับ Codex
- `agents/openai.yaml` - metadata สำหรับแสดง BetterRef ใน UI

### ตัวอย่าง prompt

```text
ใช้ BetterRef ทำหน้านี้ให้เหมือนภาพอ้างอิงมากที่สุด และอย่าบอกว่า pass ถ้ายังมี hard fail
```

```text
ใช้ BetterRef เทียบภาพ current กับ reference แล้วบอก score, hard fail, และจุดที่ต้องแก้
```

---

## English

BetterRef is a skill for matching visual references as closely as possible, including UI screenshots, mockups, dashboards, hero visuals, app redesigns, and screenshot-to-reference visual QA.

The goal is **maximum reference fidelity**, not merely matching the mood. If the user asks for a result better than the reference, that means the same composition and state with equal or higher polish, readability, asset quality, typography, and finish.

### When To Use

- The user provides a reference image and asks for a close match.
- A UI does not look like the reference.
- A hero/image/visual asset is too rich for CSS or SVG approximation.
- The work needs screenshot-to-reference visual QA.
- The target is pixel-perfect or premium visual polish.

### Core Principles

- Treat the reference image as the source of truth.
- Clearly identify which image is current and which image is the reference.
- Match state before scoring: viewport, zoom, route, tab, scroll, workspace/path, folder, and data state.
- Measure layout before judging: top bar, rail, sidebar, main workspace, right panel, hero, search card, KPI, and status bar.
- Use `imagegen` freely for hero visuals, glass/3D/cinematic visuals, textures, raster assets, and premium imagery.
- Start with local/project tools, assets, fonts, and dependencies. If they cannot close a measured visual gap, find, create, or install a scoped tool or asset.
- Use HTML/CSS/SVG for deterministic UI structure: panels, buttons, tabs, cards, forms, and layout.
- Treat typography as a core requirement: font family, Thai glyphs, fallback, weight, line-height, text boxes, line breaks, and KPI numbers.
- Capture a real screenshot in the same viewport/state as the reference before claiming completion.

### Mandatory 14-Point Gate

Before judging reference-matching work as complete, all 14 gates must be checked:

1. Identify current vs reference images clearly.
2. Match the same state before comparison: viewport, zoom, path, route, tab, scroll, folder, and data state.
3. Measure real layout instead of relying on vibes: sidebar, main workspace, right panel, hero, search card, KPI cards, and status bar.
4. Treat typography as a primary requirement: font family, Thai glyphs, weight, line-height, line breaks, and KPI numbers.
5. Focus on the largest visible mismatches first: title, chips, KPI cards, hero visual, clipping, and scrollbars.
6. Use `imagegen` freely when the target is glass, 3D, cinematic, textured, or raster-heavy instead of forcing CSS/SVG approximations.
7. Inventory available tools first: browser tooling, screenshots, DOM measurement, pixel sampling, image processing, fonts, icons, and dependencies.
8. Map every major visual gap to the tool or asset workflow that will close it.
9. If local tools are insufficient, find, create, or install scoped tooling such as pixel diff, SSIM, font inspection, background removal, or helper scripts.
10. Do not lower quality because a tool is missing when a reasonable tool can be found, generated, installed, or scripted.
11. Name the gap solved by every escalation and verify again with a fresh screenshot.
12. Produce a Visual Verdict: score, pass/revise/fail, hard-fail status, concrete differences, and next edits.
13. If any hard fail remains, never call the work `pass`, even if the subjective score feels high.
14. The final report must include tool inventory and escalations used, with the visual gap each one addressed.

### Tool Escalation

BetterRef must not lower quality because the first available tool is insufficient:

- Inventory first: browser/screenshot tooling, DOM measurement, pixel sampling, image processing, `imagegen`, local assets, installed fonts, icon libraries, and project dependencies.
- Map each visual gap to a tool, such as layout drift, font/Thai glyph mismatch, wrong hero crop, bitmap edges, clipped KPI cards, extra scrollbars, or color/shadow mismatch.
- If local tools are insufficient, use `imagegen`, find a suitable asset/font/icon/library, write a helper script, or install a temporary/project-local package.
- Every escalation must name the gap it solves and be verified with a fresh screenshot.
- Avoid global installs or new runtime dependencies unless the project actually needs them.

### Hard Fail Gates

Do not pass if any of these are present:

- Current/reference roles are unclear or reversed.
- State differs from the reference: path/folder/tab/route/scroll/viewport is wrong.
- Content is clipped, hidden, overlapped, or blocked by a bottom/status bar.
- Unexpected scrollbars or overflow appear.
- A reference one-line title wraps into multiple lines.
- Font fallback, Thai glyph shape, line-height, or text rhythm differs materially.
- A hero/raster asset has a visible bitmap box, wrong crop, or weaker lighting/depth.
- Macro layout proportions are wrong: sidebar, main, right panel, search card, KPI cards.
- Side panels collide or have tighter spacing than the reference.
- Icons look like placeholders or use the wrong visual language.
- The output only matches color or mood, not spacing/composition/hierarchy.
- There is no fresh screenshot from the actual app.

### Scoring

- `<80` = fail
- `80-89` = revise
- `90-94` = close but not complete
- `95-97` = acceptable match if no hard fail remains
- `98+` = near pixel-perfect

Hard fails override subjective scores.

### Final Report

Before claiming completion, report:

- Reference source and current screenshot source.
- Viewport/device scale and whether same-state passed.
- Visual Verdict: score, verdict, same_state, hard_fail_present.
- Top differences.
- Top next edits if the result does not pass.
- Tool inventory and any escalations used, with the visual gap each one addressed.
- Verification performed: app run, screenshot path, pixel/overlay check, and smoke tests where relevant.

### Main Files

- `SKILL.md` - the core workflow Codex follows for reference-matching work
- `agents/openai.yaml` - UI metadata for displaying BetterRef

### Example Prompts

```text
Use BetterRef to make this screen match the reference as closely as possible, and do not pass while hard fails remain.
```

```text
Use BetterRef to compare the current screenshot with the reference and report the score, hard fails, and fixes.
```
