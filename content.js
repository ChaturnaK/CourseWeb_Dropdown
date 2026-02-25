(function () {
  "use strict";

  const STORAGE_KEY = "cwQuickCourses";
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes for preloaded links
  const fetchedThisSession = new Set();

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

  /** Fetch and Cache Quick Links (Categorized, Stale-While-Revalidate) */
  async function getCourseLinks(courseId, courseUrl) {
    return new Promise((resolve) => {
      chrome.storage.local.get(`links_${courseId}`, async (data) => {
        const cached = data[`links_${courseId}`];

        const hasCache = cached && cached.categories;
        const isExpired = hasCache && (Date.now() - cached.timestamp > CACHE_TTL);
        const needsBackgroundCheck = !hasCache || isExpired || !fetchedThisSession.has(courseId);

        if (hasCache) {
          resolve(cached.categories);
        }

        if (needsBackgroundCheck) {
          fetchedThisSession.add(courseId);
          try {
            const res = await fetch(courseUrl);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");

            const sections = Array.from(doc.querySelectorAll(".section, [data-region='section'], .course-section"));
            const categories = [];
            const seenUrls = new Set();
            let linkCount = 0;

            if (sections.length > 0) {
              for (const sec of sections) {
                const titleEl = sec.querySelector("h3.sectionname, .sectionname, h3, h4");
                let title = "General";
                if (titleEl) {
                  const clone = titleEl.cloneNode(true);
                  clone.querySelectorAll('.accesshide, .sr-only').forEach(h => h.remove());
                  title = clone.textContent.trim().replace(/\s+/g, " ") || "General";
                }

                const linkEls = Array.from(sec.querySelectorAll(".activityinstance > a, a.aalink"))
                  .filter(a => a.href && !a.href.includes("javascript:") && !a.href.includes("#"));

                const links = [];
                for (const a of linkEls) {
                  if (linkCount >= 25) break;
                  let url = a.href;
                  if (seenUrls.has(url)) continue;
                  seenUrls.add(url);

                  const clone = a.cloneNode(true);
                  clone.querySelectorAll('.accesshide, .sr-only').forEach(h => h.remove());
                  let text = clone.textContent.trim().replace(/\s+/g, " ");

                  if (!text) text = a.title || "Link";

                  if (text.length > 0) {
                    links.push({ url, text });
                    linkCount++;
                  }
                }

                if (links.length > 0) {
                  categories.push({ name: title, links });
                }
                if (linkCount >= 25) break;
              }
            }

            chrome.storage.local.set({
              [`links_${courseId}`]: { timestamp: Date.now(), categories }
            });

            if (!hasCache) {
              resolve(categories);
            } else {
              const oldStr = JSON.stringify(cached.categories);
              const newStr = JSON.stringify(categories);
              if (oldStr !== newStr) {
                document.dispatchEvent(new CustomEvent('cw-qc-links-updated', {
                  detail: { courseId, categories }
                }));
              }
            }
          } catch (err) {
            console.error("Failed to fetch course links", err);
            if (!hasCache) resolve([]);
          }
        }
      });
    });
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
    const container = document.createElement("div");
    container.className = "cw-qc-item-container";
    container.dataset.courseId = course.id;
    container.draggable = true;

    const wrapper = document.createElement("div");
    wrapper.className = "cw-qc-item";

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

    const expandBtn = document.createElement("span");
    expandBtn.className = "cw-qc-expand";
    expandBtn.innerHTML = "▾";
    expandBtn.title = "Hover to view quick links";

    const removeBtn = document.createElement("button");
    removeBtn.className = "cw-qc-remove";
    removeBtn.innerHTML = "✕";
    removeBtn.title = "Remove from quick courses";
    removeBtn.dataset.action = "remove-course";
    removeBtn.dataset.courseId = course.id;

    wrapper.appendChild(handle);
    wrapper.appendChild(link);
    wrapper.appendChild(expandBtn);
    wrapper.appendChild(removeBtn);

    const submenu = document.createElement("div");
    submenu.className = "cw-qc-submenu";
    submenu.style.display = "none";

    container.appendChild(wrapper);
    container.appendChild(submenu);

    // Helper to render submenu items
    function renderSubmenu(targetSubmenu, categories) {
      targetSubmenu.innerHTML = "";
      if (!categories || categories.length === 0) {
        targetSubmenu.innerHTML = '<div class="cw-qc-submenu-empty">No sections found.</div>';
      } else {
        categories.forEach(cat => {
          const header = document.createElement("div");
          header.className = "cw-qc-category-header";
          header.textContent = cat.name;
          targetSubmenu.appendChild(header);

          cat.links.forEach(l => {
            const a = document.createElement("a");
            a.className = "dropdown-item cw-qc-sublink";
            a.href = l.url;
            a.textContent = l.text;
            a.title = l.text;
            targetSubmenu.appendChild(a);
          });
        });
      }
    }

    // ── Hover to Expand ──
    let hoverTimeout = null;
    let loadingStarted = false;

    document.addEventListener("cw-qc-links-updated", (e) => {
      if (e.detail.courseId === course.id) {
        loadingStarted = true;
        renderSubmenu(submenu, e.detail.categories);
      }
    });

    const openSubmenu = () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        expandBtn.innerHTML = "▴";
        expandBtn.classList.add("expanded");
        submenu.style.display = "block";

        if (!loadingStarted && submenu.children.length === 0) {
          loadingStarted = true;
          submenu.innerHTML = '<div class="cw-qc-submenu-loading"><div class="cw-qc-spinner"></div> Loading course outline...</div>';

          getCourseLinks(course.id, course.url).then(categories => {
            renderSubmenu(submenu, categories);
          });
        }
      }, 400); // Delay to prevent accidental expansion
    };

    const closeSubmenu = () => {
      clearTimeout(hoverTimeout);
      expandBtn.innerHTML = "▾";
      expandBtn.classList.remove("expanded");
      submenu.style.display = "none";
    };

    // Only trigger expansion on the name and arrow, not the drag handle
    link.addEventListener("mouseenter", openSubmenu);
    expandBtn.addEventListener("mouseenter", openSubmenu);

    // Explicitly clear timer if mouse enters handle or remove button 
    // (prevents timer from continuing if mouse moved from name to handle)
    handle.addEventListener("mouseenter", () => clearTimeout(hoverTimeout));
    removeBtn.addEventListener("mouseenter", () => clearTimeout(hoverTimeout));

    container.addEventListener("mouseleave", closeSubmenu);

    // ── Drag events on the container ──
    container.addEventListener("dragstart", (e) => {
      draggedItem = container;
      container.classList.add("cw-qc-item-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", course.id);

      dragPlaceholder = document.createElement("div");
      dragPlaceholder.className = "cw-qc-drag-placeholder";

      requestAnimationFrame(() => {
        container.style.opacity = "0.4";
      });
    });

    container.addEventListener("dragend", () => {
      container.classList.remove("cw-qc-item-dragging");
      container.style.opacity = "";
      if (dragPlaceholder && dragPlaceholder.parentNode) {
        dragPlaceholder.remove();
      }
      draggedItem = null;
      dragPlaceholder = null;

      persistOrderFromDOM();
    });

    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (!draggedItem || draggedItem === container) return;

      const rect = container.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        container.parentNode.insertBefore(draggedItem, container);
      } else {
        container.parentNode.insertBefore(draggedItem, container.nextSibling);
      }
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
    });

    // Fire & Forget: Prefetch on item creation, caching items eagerly
    getCourseLinks(course.id, course.url).then(categories => {
      if (!loadingStarted) {
        loadingStarted = true;
        renderSubmenu(submenu, categories);
      }
    });

    return container;
  }

  function persistOrderFromDOM() {
    const items = dropdownMenu.querySelectorAll(".cw-qc-item-container");
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

    const emptyEl = dropdownMenu.querySelector(".cw-qc-empty");
    const hintEl = dropdownMenu.querySelector(".cw-qc-hint");
    if (emptyEl) emptyEl.remove();
    if (hintEl) hintEl.remove();

    let header = document.getElementById("cw-qc-count-header");
    if (!header) {
      header = document.createElement("div");
      header.className = "cw-qc-header";
      header.id = "cw-qc-count-header";
      const firstDivider = dropdownMenu.querySelector(".dropdown-divider");
      if (firstDivider && firstDivider.nextSibling) {
        dropdownMenu.insertBefore(header, firstDivider.nextSibling);
      } else {
        dropdownMenu.prepend(header);
      }
    }
    header.textContent = `Quick Access (${courses.length})`;

    const newItem = createCourseItem(course);
    dropdownMenu.appendChild(newItem);

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

    const container = dropdownMenu.querySelector(
      `.cw-qc-item-container[data-course-id="${courseId}"]`
    );
    if (container) {
      container.classList.add("cw-qc-item-removing");
      container.addEventListener(
        "transitionend",
        () => {
          container.remove();
          afterRemove(courses);
        },
        { once: true }
      );
      setTimeout(() => {
        if (container.parentNode) {
          container.remove();
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
    dropdownToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = dropdownLi.classList.contains("show");

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
    if (document.querySelector(".cw-qc-dropdown")) return;

    const navbar = document.querySelector("ul.navbar-nav, ul.nav.navbar-nav");
    if (!navbar) return;

    const shell = await createDropdown();

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

  // ── Hot Updates Across Tabs ─────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      const newValue = changes[STORAGE_KEY].newValue || [];
      if (JSON.stringify(newValue) !== JSON.stringify(coursesCache)) {
        coursesCache = newValue;
        if (dropdownMenu) {
          populateMenu();
        }
      }
    }
  });

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
