const navItems = document.querySelectorAll(".nav-item");
const panels = document.querySelectorAll("[data-view-panel]");
const viewTargets = document.querySelectorAll("[data-view-target]");
const mailRows = document.querySelectorAll(".mail-row");
const aiInput = document.querySelector(".ai-main input");
const chips = document.querySelectorAll(".prompt-chips button");

function setView(view) {
  navItems.forEach((nav) => {
    nav.classList.toggle("active", nav.dataset.view === view);
  });
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
  history.replaceState(null, "", `#${view}`);
}

for (const item of navItems) {
  item.addEventListener("click", () => setView(item.dataset.view));
}

for (const target of viewTargets) {
  target.addEventListener("click", () => setView(target.dataset.viewTarget));
}

for (const row of mailRows) {
  row.addEventListener("click", () => {
    mailRows.forEach((item) => item.classList.remove("selected"));
    row.classList.add("selected");
  });
}

for (const chip of chips) {
  chip.addEventListener("click", () => {
    aiInput.value = chip.textContent;
    aiInput.focus();
  });
}

const initialView = location.hash.replace("#", "") || "inbox";
setView(initialView);

window.addEventListener("hashchange", () => {
  setView(location.hash.replace("#", "") || "inbox");
});
