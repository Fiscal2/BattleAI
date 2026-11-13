// A small, blocking head script applies the preference before the stylesheet paints.
// Keep this separate from the match client so every page can use it.
(() => {
  const key = "battleai-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const valid = (value: string | null): value is "light" | "dark" => value === "light" || value === "dark";
  let preference: "light" | "dark" | null = null;
  try {
    const stored = localStorage.getItem(key);
    if (valid(stored)) preference = stored;
  } catch { /* Storage can be unavailable in privacy-restricted browsers. */ }

  function apply() {
    const theme = preference ?? (system.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0a0a" : "#fafaf9");
    const button = document.querySelector("#theme-toggle");
    if (button) {
      const destination = theme === "dark" ? "Light mode" : "Dark mode";
      const label = button.querySelector("span");
      if (label) label.textContent = destination;
      button.setAttribute("aria-label", `Switch to ${destination.toLowerCase()}`);
      button.setAttribute("title", `Switch to ${destination.toLowerCase()}`);
    }
  }

  apply();
  system.addEventListener("change", () => { if (preference === null) apply(); });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
    if (!button) return;
    apply();
    button.hidden = false;
    button.addEventListener("click", () => {
      preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      apply();
      try { localStorage.setItem(key, preference); } catch { /* The toggle still works for this page. */ }
    });
  });
})();
