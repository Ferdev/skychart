export function bindMapSettings() {
  const toolbar = document.querySelector<HTMLElement>(".atlas-toolbar");
  const settings = document.querySelector<HTMLElement>("#map-settings");
  const toggle = document.querySelector<HTMLButtonElement>("#map-settings-toggle");
  if (!toolbar || !settings || !toggle) return;
  const position = () => {
    const rect = toolbar.getBoundingClientRect();
    const bottom = Math.max(12, window.innerHeight - rect.top + 10);
    document.documentElement.style.setProperty("--atlas-toolbar-height", `${rect.height}px`);
    settings.style.left = `${rect.left}px`;
    settings.style.bottom = `${bottom}px`;
    settings.style.maxHeight = `${Math.max(120, rect.top - 24)}px`;
  };
  new ResizeObserver(position).observe(toolbar);
  window.addEventListener("resize", position);
  settings.addEventListener("toggle", () => {
    const open = settings.matches(":popover-open");
    toggle.setAttribute("aria-expanded", String(open));
    if (open) position();
  });
  // Native popovers handle Escape, outside clicks, and keyboard focus return.
  // Close the panel when switching away from the atlas into the sky view.
  new MutationObserver(() => {
    if (document.body.dataset.skyView === "true" && settings.matches(":popover-open")) settings.hidePopover();
  }).observe(document.body, { attributes: true, attributeFilter: ["data-sky-view"] });
  position();
}

export function bindScaleDisclosures(root: ParentNode = document) {
  const disclosures = Array.from(root.querySelectorAll<HTMLElement>("[data-scale-disclosure]"));

  const setOpen = (section: HTMLElement, open: boolean) => {
    const toggle = section.querySelector<HTMLButtonElement>(".scale-collapse__toggle");
    const contentId = toggle?.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;
    if (!toggle || !content) return;
    toggle.setAttribute("aria-expanded", String(open));
    content.hidden = !open;
    section.classList.toggle("is-open", open);
  };

  for (const section of disclosures) {
    const toggle = section.querySelector<HTMLButtonElement>(".scale-collapse__toggle");
    if (!toggle) continue;
    toggle.addEventListener("click", () => {
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      for (const disclosure of disclosures) setOpen(disclosure, opening && disclosure === section);
      if (opening) window.requestAnimationFrame(() => section.scrollIntoView({ block: "nearest" }));
    });
  }
}

export function bindControlInfoTips(
  tooltip: HTMLElement,
  root: ParentNode = document
) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".info-tip[data-info]"));
  let pinnedButton: HTMLButtonElement | null = null;

  const hide = () => {
    if (tooltip.matches(":popover-open")) tooltip.hidePopover();
    for (const button of buttons) button.removeAttribute("data-active");
  };

  const show = (button: HTMLButtonElement) => {
    const message = button.dataset.info;
    if (!message) return;
    tooltip.textContent = message;
    if (!tooltip.matches(":popover-open")) tooltip.showPopover();
    for (const candidate of buttons) candidate.toggleAttribute("data-active", candidate === button);

    const buttonBounds = button.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const gutter = 12;
    const left = Math.min(
      Math.max(gutter, buttonBounds.left + buttonBounds.width / 2 - tooltipBounds.width / 2),
      window.innerWidth - tooltipBounds.width - gutter
    );
    const below = buttonBounds.bottom + 8;
    const top = below + tooltipBounds.height <= window.innerHeight - gutter
      ? below
      : Math.max(gutter, buttonBounds.top - tooltipBounds.height - 8);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };

  for (const button of buttons) {
    button.addEventListener("pointerenter", () => show(button));
    button.addEventListener("pointerleave", () => { if (pinnedButton !== button) hide(); });
    button.addEventListener("focus", () => show(button));
    button.addEventListener("blur", () => { if (pinnedButton !== button) hide(); });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pinnedButton === button) {
        pinnedButton = null;
        hide();
        return;
      }
      pinnedButton = button;
      show(button);
    });
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!pinnedButton || !(target instanceof Node)) return;
    if (pinnedButton.contains(target) || tooltip.contains(target)) return;
    pinnedButton = null;
    hide();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !tooltip.matches(":popover-open")) return;
    event.preventDefault();
    pinnedButton = null;
    hide();
  });
}
