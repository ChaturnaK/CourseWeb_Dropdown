# 📚 CourseWeb Quick Courses

<p align="center">
  <img src="icons/icon128.png" alt="CourseWeb Quick Courses" width="96" />
</p>

<p align="center">
  <strong>A browser extension that adds a quick-access course dropdown to the SLIIT CourseWeb navbar.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome-Extension-green" alt="Chrome Extension" />
  <img src="https://img.shields.io/badge/Firefox-Extension-FF7139" alt="Firefox Extension" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License" />
</p>

---

## ✨ Features

- **📚 Courses Dropdown** — Injected into the CourseWeb navbar right next to "Email"
- **➕ One-Click Save** — Visit any course page and instantly bookmark it from the dropdown
- **☰ Drag to Reorder** — Arrange your courses in the order you prefer with drag-and-drop handles
- **✕ Quick Remove** — Remove saved courses with one click
- **🔄 Synced Storage** — Saved courses persist across sessions and sync via your Chrome profile
- **⚡ Performance Optimized** — In-memory cache, MutationObserver init, event delegation, surgical DOM updates, debounced writes

---

## 📦 Installation

### For Chrome, Edge, Brave (Chromium)
1. **Clone or download** this repository
2. Open your browser and navigate to `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (top-right toggle)
4. Click **"Load unpacked"**
5. Select the `CourseWeb_Dropdown` folder
6. Navigate to [courseweb.sliit.lk](https://courseweb.sliit.lk) and log in

### For Firefox
1. **Clone or download** this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file inside the `CourseWeb_Dropdown` folder
5. Navigate to [courseweb.sliit.lk](https://courseweb.sliit.lk) and log in

---

## 🚀 Usage

### Adding a Course
1. Navigate to any course page on CourseWeb (e.g. `courseweb.sliit.lk/course/view.php?id=...`)
2. Click the **📚 Courses** dropdown in the navbar
3. Click **➕ Add This Course**

### Accessing Saved Courses
- Click **📚 Courses** → click any saved course to navigate directly

### Reordering Courses
- Grab the **☰** handle next to a course name and drag it to your preferred position
- New order saves automatically

### Removing a Course
- Hover over a course → click the **✕** button

---

## 🏗️ Project Structure

```
CourseWeb_Dropdown/
├── manifest.json       # Extension config (Manifest V3)
├── content.js          # Content script — navbar injection & course management
├── content.css         # Dropdown styling — dark theme, drag states
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic
├── popup.css           # Popup styling
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## ⚡ Performance

| Optimization | Description |
|---|---|
| **In-memory cache** | `chrome.storage.sync` read once, then cached |
| **MutationObserver** | Replaces polling — injects immediately when navbar appears |
| **Event delegation** | Single listener handles all menu interactions |
| **Surgical DOM updates** | Add/remove modifies individual elements, no full rebuilds |
| **Debounced writes** | Batches rapid changes into one 150ms storage write |
| **GPU compositing** | `will-change` and `contain` CSS hints for smooth animations |

---

## 🛠️ Tech Stack

- **Manifest V3** Chrome Extension API
- **Vanilla JavaScript** — no dependencies
- **HTML5 Drag and Drop** API for course reordering
- **chrome.storage.sync** for persistent, synced storage
- **Bootstrap-compatible** injection (matches CourseWeb's existing navbar)

---

## 📋 Compatibility

- ✅ Google Chrome
- ✅ Mozilla Firefox
- ✅ Microsoft Edge
- ✅ Brave Browser
- ✅ Any Chromium-based browser

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built for <strong>SLIIT University</strong> students 🎓
</p>
