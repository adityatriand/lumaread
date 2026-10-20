// A layer covering exactly the rendered page image. pdf.js insets the canvas inside the page box and
// .canvasWrapper isn't positioned, so overlays must copy its offsets rather than use inset: 0.
// Rebuilt on every render: offsets and sizes change with zoom.
export function pageOverlay(pageDiv: HTMLElement, className: string): HTMLDivElement | undefined {
  pageDiv.querySelector(`:scope > .${className}`)?.remove();
  const wrapper = pageDiv.querySelector<HTMLElement>(".canvasWrapper");
  if (!wrapper) return undefined;
  const layer = document.createElement("div");
  layer.className = className;
  Object.assign(layer.style, {
    position: "absolute",
    left: `${wrapper.offsetLeft}px`,
    top: `${wrapper.offsetTop}px`,
    width: `${wrapper.offsetWidth}px`,
    height: `${wrapper.offsetHeight}px`,
  });
  pageDiv.appendChild(layer);
  return layer;
}
