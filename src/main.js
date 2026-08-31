/* Handheld Daily — app-like input behavior for the LCD screen. */
(function () {
  "use strict";

  // Block pinch-zoom and double-tap zoom on browsers that ignore
  // user-scalable=no (iOS Safari since 10).
  document.addEventListener(
    "gesturestart",
    function (event) {
      event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    function (event) {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );

  var lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    function (event) {
      var now = Date.now();
      if (now - lastTouchEnd <= 300) event.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );

  // Long-press selection / context menu.
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });
})();
