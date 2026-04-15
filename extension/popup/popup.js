const NATIVE_HOST = "ffx_profile_switcher";

const THEMES = [
  "ayu-dark", "ayu-mirage", "ayu-light",
  "tokyo-night", "tokyo-storm", "tokyo-light"
];

const THEME_LABELS = {
  "ayu-dark": "Ayu Dark",
  "ayu-mirage": "Ayu Mirage",
  "ayu-light": "Ayu Light",
  "tokyo-night": "Tokyo Night",
  "tokyo-storm": "Tokyo Storm",
  "tokyo-light": "Tokyo Light"
};

// Cached DOM elements
const errorEl = document.getElementById("error");
const profileList = document.getElementById("profile-list");
const emptyState = document.getElementById("empty-state");
const createBtn = document.getElementById("create-btn");
const createForm = document.getElementById("create-form");
const createInput = document.getElementById("create-input");
const createSubmit = document.getElementById("create-submit");
const createCancel = document.getElementById("create-cancel");

// Cached profile data for re-renders without native host round-trip
let cachedProfiles = null;
let cachedCurrentProfile = null;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

function closeAllMenus() {
  const menu = document.querySelector(".profile-menu");
  if (menu) menu.remove();
}

async function loadTheme() {
  const result = await browser.storage.local.get("theme");
  applyTheme(result.theme || "tokyo-night");
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  document.getElementById("theme-toggle").title = THEME_LABELS[theme];
}

function cycleTheme() {
  const current = document.body.getAttribute("data-theme") || "tokyo-night";
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
  browser.storage.local.set({ theme: next });
  if (cachedProfiles) {
    renderProfiles(cachedProfiles, cachedCurrentProfile);
  }
}

async function loadProfiles() {
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "list"
    });

    if (response.error) {
      showError(response.error);
      return;
    }

    cachedProfiles = response.profiles;
    cachedCurrentProfile = response.current_profile;
    renderProfiles(cachedProfiles, cachedCurrentProfile);
  } catch (err) {
    showError(
      "Cannot connect to native host. Run the install script first. (" + err.message + ")"
    );
  }
}

function renderProfiles(profiles, currentProfile) {
  profileList.replaceChildren();

  if (profiles.length === 0) {
    profileList.hidden = true;
    emptyState.textContent = "No profiles found. Create one below.";
    emptyState.hidden = false;
    return;
  }

  if (profiles.length === 1) {
    emptyState.textContent = "Create another profile to switch between them.";
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
  }

  profileList.hidden = false;

  const style = getComputedStyle(document.body);
  const fragment = document.createDocumentFragment();

  profiles.forEach((profile, index) => {
    const isDefault = profile.name === currentProfile;
    const item = document.createElement("div");
    item.className = "profile-item" + (isDefault ? " current" : "");

    const avatar = document.createElement("div");
    avatar.className = "profile-avatar";
    avatar.style.background = style.getPropertyValue("--avatar-" + ((index % 8) + 1)).trim();
    avatar.textContent = profile.name.charAt(0).toUpperCase();
    item.appendChild(avatar);

    const info = document.createElement("div");
    info.className = "profile-info";

    const name = document.createElement("div");
    name.className = "profile-name";
    name.textContent = profile.name;
    info.appendChild(name);

    if (isDefault) {
      const badge = document.createElement("div");
      badge.className = "profile-badge";
      badge.textContent = "default";
      info.appendChild(badge);
    }

    item.appendChild(info);

    if (index < 9) {
      const shortcut = document.createElement("div");
      shortcut.className = "profile-shortcut";
      shortcut.textContent = String(index + 1);
      item.appendChild(shortcut);
    }

    const menuBtn = document.createElement("button");
    menuBtn.className = "profile-menu-btn";
    menuBtn.textContent = "\u22EE";
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(menuBtn, item, profile, isDefault);
    });
    item.appendChild(menuBtn);

    item.addEventListener("click", () => switchProfile(profile.name));
    fragment.appendChild(item);
  });

  profileList.appendChild(fragment);
}

function toggleMenu(btnEl, item, profile, isDefault) {
  const hadMenu = document.querySelector(".profile-menu");
  closeAllMenus();
  if (hadMenu) return;

  const menu = document.createElement("div");
  menu.className = "profile-menu";

  const renameOpt = document.createElement("div");
  renameOpt.className = "profile-menu-option";
  renameOpt.textContent = "Rename";
  renameOpt.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllMenus();
    showRenameUI(item, profile);
  });
  menu.appendChild(renameOpt);

  if (!isDefault) {
    const defaultOpt = document.createElement("div");
    defaultOpt.className = "profile-menu-option";
    defaultOpt.textContent = "Set as Default";
    defaultOpt.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllMenus();
      setDefault(profile.name);
    });
    menu.appendChild(defaultOpt);
  }

  document.body.appendChild(menu);

  const btnRect = btnEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();

  let top = itemRect.top + (itemRect.height - menuRect.height) / 2;
  const bodyRect = document.body.getBoundingClientRect();
  if (top < bodyRect.top) {
    top = bodyRect.top;
  }
  if (top + menuRect.height > bodyRect.bottom) {
    top = bodyRect.bottom - menuRect.height;
  }

  menu.style.top = top + "px";
  menu.style.left = (btnRect.left - menuRect.width - 4) + "px";
}

function restoreNameEl(target, name) {
  const el = document.createElement("div");
  el.className = "profile-name";
  el.textContent = name;
  target.replaceWith(el);
}

function showRenameUI(item, profile) {
  const nameEl = item.querySelector(".profile-name");
  const originalName = profile.name;

  const input = document.createElement("input");
  input.className = "rename-input";
  input.type = "text";
  input.value = originalName;
  input.maxLength = 64;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  function finishRename() {
    const newName = input.value.trim();
    if (newName && newName !== originalName) {
      renameProfile(originalName, newName);
    } else {
      restoreNameEl(input, originalName);
    }
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      finishRename();
    } else if (e.key === "Escape") {
      restoreNameEl(input, originalName);
    }
  });

  input.addEventListener("blur", finishRename);
}

async function renameProfile(oldName, newName) {
  clearError();
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "rename",
      old_name: oldName,
      new_name: newName
    });

    if (response.error) {
      showError(response.error);
      return;
    }

    loadProfiles();
  } catch (err) {
    showError("Failed to rename profile: " + err.message);
  }
}

async function setDefault(profileName) {
  clearError();
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "set_default",
      profile: profileName
    });

    if (response.error) {
      showError(response.error);
      return;
    }

    loadProfiles();
  } catch (err) {
    showError("Failed to set default: " + err.message);
  }
}

async function switchProfile(profileName) {
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "launch",
      profile: profileName
    });

    if (response.error) {
      showError(response.error);
      return;
    }

    window.close();
  } catch (err) {
    showError("Failed to switch profile: " + err.message);
  }
}

function showCreateForm() {
  createBtn.hidden = true;
  createForm.hidden = false;
  createInput.value = "";
  createInput.focus();
  clearError();
}

function hideCreateForm() {
  createForm.hidden = true;
  createBtn.hidden = false;
  clearError();
}

async function submitCreateProfile() {
  const name = createInput.value.trim();
  if (!name) return;

  createSubmit.disabled = true;
  createSubmit.textContent = "Creating...";
  clearError();

  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "create",
      profile: name
    });

    if (response.error) {
      showError(response.error);
      return;
    }

    hideCreateForm();
    loadProfiles();
  } catch (err) {
    showError("Failed to create profile: " + err.message);
  } finally {
    createSubmit.disabled = false;
    createSubmit.textContent = "Create";
  }
}

createBtn.addEventListener("click", showCreateForm);
createCancel.addEventListener("click", hideCreateForm);
createSubmit.addEventListener("click", submitCreateProfile);
createInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    submitCreateProfile();
  } else if (e.key === "Escape") {
    hideCreateForm();
  }
});

document.getElementById("theme-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  cycleTheme();
});

document.getElementById("manage-link").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await browser.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "open_about_profiles"
    });
  } catch (_) {
    // ignore
  }
  window.close();
});

document.addEventListener("click", closeAllMenus);

document.addEventListener("keydown", (e) => {
  if (!createForm.hidden) return;
  if (document.activeElement && document.activeElement.classList.contains("rename-input")) return;
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= 9 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const items = profileList.children;
    if (items[num - 1]) {
      items[num - 1].click();
    }
  }
});

loadTheme().then(() => loadProfiles());
