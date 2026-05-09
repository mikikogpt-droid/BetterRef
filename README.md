# BetterRef

## ภาษาไทย

BetterRef เป็น skill สำหรับงานที่ต้องทำตามภาพอ้างอิงให้ใกล้ที่สุด เช่น UI screenshot, mockup, hero visual, dashboard, web/app redesign หรือภาพ reference ที่ผู้ใช้บอกว่าอยากให้เหมือน

เป้าหมายหลักคือ **visual fidelity สูงสุด** ไม่ใช่แค่โทนคล้าย หรือวาดทุกอย่างด้วยโค้ดให้ได้เท่านั้น

### ใช้เมื่อไหร่

- ผู้ใช้แนบภาพอ้างอิงแล้วบอกให้ทำให้เหมือน
- ต้องทำ UI ให้ตรง screenshot หรือ mockup
- ต้องแก้งานที่ “ยังไม่เหมือน ref”
- ต้องทำ hero/image/visual asset ที่ CSS หรือ SVG ทำได้แค่เลียนแบบ
- ต้องตรวจงานด้วย screenshot เทียบ reference

### หลักการสำคัญ

- ใช้ reference image เป็น source of truth
- แยกงาน UI shell กับ visual asset ออกจากกัน
- ใช้ HTML/CSS/SVG กับ layout, panel, button, tab, card, form และ state ที่ต้อง deterministic
- ใช้ `imagegen` เต็มที่กับ hero, raster asset, glass/3D/cinematic visual, texture, mockup และภาพที่ต้องสวย premium
- ถ่าย screenshot จริง แล้วเทียบกับ reference ก่อนบอกว่างานเสร็จ
- ใช้ Visual Verdict Gate ให้คะแนน 0-100 พร้อม `differences` และ `suggestions`
- ถ้าคะแนนต่ำกว่า 90 ให้แก้ต่อหรือรายงานช่องว่างอย่างตรงไปตรงมา

### ไฟล์หลัก

- `SKILL.md` - workflow หลักที่ Codex ใช้เมื่อต้องทำงานตาม reference
- `agents/openai.yaml` - metadata สำหรับแสดงชื่อ BetterRef ใน UI

### ประโยคเรียกใช้ตัวอย่าง

```text
ใช้ BetterRef ทำหน้านี้ให้เหมือนภาพอ้างอิงมากที่สุด
```

```text
ใช้ BetterRef ตรวจว่าหน้าปัจจุบันเหมือน reference กี่เปอร์เซ็นต์ แล้วบอกจุดที่ต้องแก้
```

---

## English

BetterRef is a skill for matching visual references as closely as possible, including UI screenshots, mockups, hero visuals, dashboards, web/app redesigns, and any reference image the user wants reproduced.

The primary goal is **maximum visual fidelity**, not merely matching the mood or forcing every visual detail to be code-native.

### When To Use

- The user provides a reference image and asks for a close match.
- A UI must match a screenshot or mockup.
- Existing work “does not look like the reference.”
- A hero/image/visual asset is too rich for CSS or SVG approximation.
- The work needs screenshot-to-reference visual QA.

### Core Principles

- Treat the reference image as the source of truth.
- Separate UI shell work from visual asset production.
- Use HTML/CSS/SVG for deterministic layout, panels, buttons, tabs, cards, forms, and states.
- Use `imagegen` freely for hero visuals, raster assets, glass/3D/cinematic visuals, textures, mockups, and premium imagery.
- Capture a real screenshot and compare it against the reference before claiming completion.
- Use a Visual Verdict Gate with a 0-100 score plus `differences` and `suggestions`.
- If the score is below 90, continue editing or report the remaining gaps honestly.

### Main Files

- `SKILL.md` - the core workflow Codex follows for reference-matching work
- `agents/openai.yaml` - UI metadata for displaying BetterRef

### Example Prompts

```text
Use BetterRef to make this screen match the reference image as closely as possible.
```

```text
Use BetterRef to score the current screen against the reference and list the fixes needed.
```
