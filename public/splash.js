try {
  var prefs = JSON.parse(localStorage.getItem("reading-prefs") || "{}");
  var theme = prefs.appTheme || "light";
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
} catch (e) {}

// Inline scripts are blocked by the app content security policy, so this file removes the splash.
document.addEventListener("DOMContentLoaded", function () {
  var splash = document.getElementById("splash");
  if (!splash) return;
  var gone = false;
  function remove() {
    if (gone) return;
    gone = true;
    splash.remove();
  }
  splash.addEventListener("animationend", function (e) {
    if (e.animationName === "splash-leave") remove();
  });
  setTimeout(remove, 2600);
});
