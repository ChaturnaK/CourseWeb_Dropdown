(function () {
  "use strict";

  const STORAGE_KEY = "cwQuickCourses";

  // ── In-memory cache ─────────────────────────────────────
  let coursesCache = null;
  let outsideClickRegistered = false;
  let saveDebounceTimer = null;

  /** Load courses — uses cache if available */
  async function loadCourses() {
    if (coursesCache !== null) return coursesCache;
    return new Promise((resolve) => {
      chrome.storage.sync.get(STORAGE_KEY, (data) => {
        coursesCache = data[STORAGE_KEY] || [];
        resolve(coursesCache);
      });
    });
  }

  /** Debounced persist */
  function saveCourses(courses) {
    coursesCache = courses;
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      chrome.storage.sync.set({ [STORAGE_KEY]: courses });
    }, 150);
  }

  /** Detect if current page is a course page */
  function detectCoursePage() {
    const url = new URL(window.location.href);
    if (url.pathname === "/course/view.php" && url.searchParams.get("id")) {
      return {
        id: url.searchParams.get("id"),
        url: window.location.href,
        name: extractCourseName(),
      };
    }
    return null;
  }

  /** Extract course name from page */
  function extractCourseName() {
    const header = document.querySelector(".page-header-headings h1");
    if (header) return header.textContent.trim();

    const crumbs = document.querySelectorAll(
      ".breadcrumb-item a, .breadcrumb a"
    );
    if (crumbs.length > 0) {
      return crumbs[crumbs.length - 1].textContent.trim();
    }

    return document.title.replace(" | CourseWeb", "").trim();
  }

  // ── DOM references (set once) ───────────────────────────
  let dropdownLi = null;
  let dropdownToggle = null;
  let dropdownMenu = null;

  // ── Drag state ──────────────────────────────────────────
  let draggedItem = null;
  let dragPlaceholder = null;

  // ── Dropdown Builder (populated immediately) ────────────

  async function createDropdown() {
    const li = document.createElement("li");
    li.className = "dropdown nav-item cw-qc-dropdown";
    li.role = "none";

    const toggle = document.createElement("a");
    toggle.className = "dropdown-toggle nav-link";
    toggle.id = "drop-down-quick-courses";
    toggle.role = "menuitem";
    toggle.href = "#";
    toggle.tabIndex = -1;
    toggle.setAttribute("data-toggle", "dropdown");
    toggle.setAttribute("aria-haspopup", "true");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<span class="cw-qc-icon">📚</span> Courses';

    const menu = document.createElement("div");
    menu.className = "dropdown-menu cw-qc-menu";
    menu.role = "menu";
    menu.setAttribute("aria-labelledby", "drop-down-quick-courses");

    li.appendChild(toggle);
    li.appendChild(menu);

    dropdownLi = li;
    dropdownToggle = toggle;
    dropdownMenu = menu;

    // Populate immediately
    await populateMenu();

    return li;
  }

  // ── Populate menu ───────────────────────────────────────

  async function populateMenu() {
    const courses = await loadCourses();
    const currentCourse = detectCoursePage();

    dropdownMenu.innerHTML = "";

    // "Add This Course" or "Currently Saved"
    const isAlreadySaved =
      currentCourse && courses.some((c) => c.id === currentCourse.id);

    if (currentCourse && !isAlreadySaved) {
      const addItem = document.createElement("a");
      addItem.className = "dropdown-item cw-qc-add";
      addItem.role = "menuitem";
      addItem.href = "#";
      addItem.dataset.action = "add-course";
      addItem.innerHTML = "➕ Add This Course";
      dropdownMenu.appendChild(addItem);
      dropdownMenu.appendChild(createDivider());
    } else if (currentCourse && isAlreadySaved) {
      const badge = document.createElement("div");
      badge.className = "dropdown-item cw-qc-saved-badge";
      badge.innerHTML = "✅ Currently Saved";
      dropdownMenu.appendChild(badge);
      dropdownMenu.appendChild(createDivider());
    }

    // Course list or empty state
    if (courses.length === 0) {
      appendEmptyState();
    } else {
      appendCourseList(courses);
    }
  }

  function appendEmptyState() {
    const empty = document.createElement("div");
    empty.className = "dropdown-item cw-qc-empty";
    empty.textContent = "No courses saved yet";
    dropdownMenu.appendChild(empty);

    const hint = document.createElement("div");
    hint.className = "dropdown-item cw-qc-hint";
    hint.textContent = "Visit a course page to add it!";
    dropdownMenu.appendChild(hint);
  }

  function appendCourseList(courses) {
    const header = document.createElement("div");
    header.className = "cw-qc-header";
    header.id = "cw-qc-count-header";
    header.textContent = `Quick Access (${courses.length})`;
    dropdownMenu.appendChild(header);

    courses.forEach((course) => {
      dropdownMenu.appendChild(createCourseItem(course));
    });
  }

  function createCourseItem(course) {
    const wrapper = document.createElement("div");
    wrapper.className = "cw-qc-item";
    wrapper.dataset.courseId = course.id;
    wrapper.draggable = true;

    // Drag handle (sandwich icon)
    const handle = document.createElement("span");
    handle.className = "cw-qc-drag-handle";
    handle.innerHTML = "☰";
    handle.title = "Drag to reorder";

    const link = document.createElement("a");
    link.className = "dropdown-item cw-qc-link";
    link.role = "menuitem";
    link.href = course.url;
    link.title = course.name;
    link.textContent = course.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "cw-qc-remove";
    removeBtn.innerHTML = "✕";
    removeBtn.title = "Remove from quick courses";
    removeBtn.dataset.action = "remove-course";
    removeBtn.dataset.courseId = course.id;

    wrapper.appendChild(handle);
    wrapper.appendChild(link);
    wrapper.appendChild(removeBtn);

    // ── Drag events on the item ──
    wrapper.addEventListener("dragstart", (e) => {
      // Only allow drag from the handle
      if (!e.target.closest(".cw-qc-drag-handle") && e.target !== wrapper) {
        // Allow drag to start from wrapper but visually only handle is cursor:grab
      }
      draggedItem = wrapper;
      wrapper.classList.add("cw-qc-item-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", course.id);

      // Create a placeholder
      dragPlaceholder = document.createElement("div");
      dragPlaceholder.className = "cw-qc-drag-placeholder";

      // Slight delay so the drag image renders correctly
      requestAnimationFrame(() => {
        wrapper.style.opacity = "0.4";
      });
    });

    wrapper.addEventListener("dragend", () => {
      wrapper.classList.remove("cw-qc-item-dragging");
      wrapper.style.opacity = "";
      if (dragPlaceholder && dragPlaceholder.parentNode) {
        dragPlaceholder.remove();
      }
      draggedItem = null;
      dragPlaceholder = null;

      // Persist new order from DOM
      persistOrderFromDOM();
    });

    wrapper.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (!draggedItem || draggedItem === wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        wrapper.parentNode.insertBefore(draggedItem, wrapper);
      } else {
        wrapper.parentNode.insertBefore(draggedItem, wrapper.nextSibling);
      }
    });

    wrapper.addEventListener("drop", (e) => {
      e.preventDefault();
    });

    return wrapper;
  }

  /** Read the new order from the DOM and persist */
  function persistOrderFromDOM() {
    const items = dropdownMenu.querySelectorAll(".cw-qc-item");
    const newOrder = [];
    items.forEach((item) => {
      const id = item.dataset.courseId;
      const course = coursesCache.find((c) => c.id === id);
      if (course) newOrder.push(course);
    });
    if (newOrder.length > 0) {
      saveCourses(newOrder);
    }
  }

  function createDivider() {
    const div = document.createElement("div");
    div.className = "dropdown-divider";
    return div;
  }

  // ── Surgical DOM updates ────────────────────────────────

  function surgicalAddCourse(course) {
    const courses = coursesCache;
    if (courses.some((c) => c.id === course.id)) return;

    courses.push(course);
    saveCourses(courses);

    // Remove empty state if present
    const emptyEl = dropdownMenu.querySelector(".cw-qc-empty");
    const hintEl = dropdownMenu.querySelector(".cw-qc-hint");
    if (emptyEl) emptyEl.remove();
    if (hintEl) hintEl.remove();

    // Ensure header exists
    let header = document.getElementById("cw-qc-count-header");
    if (!header) {
      header = document.createElement("div");
      header.className = "cw-qc-header";
      header.id = "cw-qc-count-header";
      // Insert after divider following the add button (or at top)
      const firstDivider = dropdownMenu.querySelector(".dropdown-divider");
      if (firstDivider && firstDivider.nextSibling) {
        dropdownMenu.insertBefore(header, firstDivider.nextSibling);
      } else {
        dropdownMenu.prepend(header);
      }
    }
    header.textContent = `Quick Access (${courses.length})`;

    // Append new item at the end of the list
    const newItem = createCourseItem(course);
    dropdownMenu.appendChild(newItem);

    // Swap "Add" button → "Saved" badge
    const addBtn = dropdownMenu.querySelector('[data-action="add-course"]');
    if (addBtn) {
      const badge = document.createElement("div");
      badge.className = "dropdown-item cw-qc-saved-badge";
      badge.innerHTML = "✅ Currently Saved";
      addBtn.replaceWith(badge);
    }
  }

  function surgicalRemoveCourse(courseId) {
    const courses = coursesCache.filter((c) => c.id !== courseId);
    coursesCache = courses;
    saveCourses(courses);

    // Animate out the item
    const item = dropdownMenu.querySelector(
      `.cw-qc-item[data-course-id="${courseId}"]`
    );
    if (item) {
      item.classList.add("cw-qc-item-removing");
      item.addEventListener(
        "transitionend",
        () => {
          item.remove();
          afterRemove(courses);
        },
        { once: true }
      );
      // Fallback if transition doesn't fire
      setTimeout(() => {
        if (item.parentNode) {
          item.remove();
          afterRemove(courses);
        }
      }, 250);
    } else {
      afterRemove(courses);
    }
  }

  function afterRemove(courses) {
    const header = document.getElementById("cw-qc-count-header");
    if (courses.length === 0) {
      if (header) header.remove();
      appendEmptyState();
    } else if (header) {
      header.textContent = `Quick Access (${courses.length})`;
    }
  }

  // ── Event Delegation ────────────────────────────────────

  function setupEventDelegation() {
    // Toggle click
    dropdownToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = dropdownLi.classList.contains("show");

      // Close all other dropdowns
      document
        .querySelectorAll(".dropdown.nav-item.show")
        .forEach((openDd) => {
          openDd.classList.remove("show");
          const m = openDd.querySelector(".dropdown-menu");
          if (m) m.classList.remove("show");
        });

      if (!isOpen) {
        dropdownLi.classList.add("show");
        dropdownMenu.classList.add("show");
        dropdownToggle.setAttribute("aria-expanded", "true");
      } else {
        dropdownLi.classList.remove("show");
        dropdownMenu.classList.remove("show");
        dropdownToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Delegated menu clicks
    dropdownMenu.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      const action = target.dataset.action;

      if (action === "add-course") {
        const course = detectCoursePage();
        if (course) surgicalAddCourse(course);
      } else if (action === "remove-course") {
        const courseId = target.dataset.courseId;
        if (courseId) surgicalRemoveCourse(courseId);
      }
    });

    // Single outside-click listener (no leaks)
    if (!outsideClickRegistered) {
      outsideClickRegistered = true;
      document.addEventListener("click", (e) => {
        if (dropdownLi && !dropdownLi.contains(e.target)) {
          dropdownLi.classList.remove("show");
          dropdownMenu.classList.remove("show");
          dropdownToggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  // ── Injection ───────────────────────────────────────────

  async function injectDropdown() {
    // Guard: don't double-inject
    if (document.querySelector(".cw-qc-dropdown")) return;

    const navbar = document.querySelector("ul.navbar-nav, ul.nav.navbar-nav");
    if (!navbar) return;

    const shell = await createDropdown();

    // Find Email dropdown to insert after
    const emailToggle = navbar.querySelector(
      '[id^="drop-down-"][id*="email"], [id^="drop-down-email"]'
    );
    const emailLi = emailToggle ? emailToggle.closest("li.nav-item") : null;

    if (emailLi && emailLi.nextSibling) {
      navbar.insertBefore(shell, emailLi.nextSibling);
    } else if (emailLi) {
      navbar.appendChild(shell);
    } else {
      navbar.appendChild(shell);
    }

    setupEventDelegation();
  }

  // ── MutationObserver init ───────────────────────────────

  function init() {
    const navbar = document.querySelector("ul.navbar-nav, ul.nav.navbar-nav");
    if (navbar) {
      injectDropdown();
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const nav = document.querySelector("ul.navbar-nav, ul.nav.navbar-nav");
      if (nav) {
        obs.disconnect();
        injectDropdown();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Safety timeout: disconnect after 10s
    setTimeout(() => {
      observer.disconnect();
    }, 10000);
  }

  // ── Run ─────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
