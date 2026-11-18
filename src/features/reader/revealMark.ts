export function revealMark(el: Element | null | undefined, scroller: HTMLElement | null | undefined) {
  if (!el || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
  const box = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top >= box.top + 140 && r.bottom <= box.bottom - 80) return;
  scroller.scrollBy({ top: r.top - (box.top + box.height * 0.4) });
}
