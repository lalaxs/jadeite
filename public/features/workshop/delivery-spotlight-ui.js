export function createDeliverySpotlightUi({ session, animate, isActive, onDialog }) {
  const { root, q } = session;
  const events = new AbortController();
  let mode = root.classList.contains("is-scratch-spotlight") ? "scratch" : "dialog";
  let reviewPointerStarted = false;

  function showReview() {
    mode = "review";
    reviewPointerStarted = false;
    session.scratch.enable(false);
    const summary = q("[data-delivery-summary]");
    summary.innerHTML = session.details.summary(session.delivery.items[0]);
    summary.hidden = false;
    root.classList.add("is-scratch-review");
    q("[data-delivery-close]").hidden = true;
    q("[data-delivery-return]").hidden = false;
    q("[data-delivery-return]").focus({ preventScroll: true });
    session.scratch.layout();
  }

  async function returnToDialog() {
    if (mode !== "review" || !isActive()) return;
    mode = "returning";
    const visual = q(".delivery-item-visual");
    const from = visual.getBoundingClientRect();
    root.classList.remove("is-scratch-spotlight", "is-scratch-review");
    q("[data-delivery-summary]").hidden = true;
    q("[data-delivery-return]").hidden = true;
    const close = q("[data-delivery-close]");
    close.hidden = false; close.className = "modal-close"; close.textContent = "×";
    close.setAttribute("aria-label", "关闭，稍后继续领取");
    q(".delivery-head").append(close);
    q("[data-delivery-collect]").hidden = false;
    q("[data-delivery-collect]").disabled = true;
    session.scratch.layout();
    const to = visual.getBoundingClientRect();
    await animate(session, visual, [
      { transform: `translate(${from.x + from.width / 2 - to.x - to.width / 2}px,${from.y + from.height / 2 - to.y - to.height / 2}px) scale(${Math.min(from.width, from.height) / Math.min(to.width, to.height)})` },
      { transform: "none" }
    ], { duration: 360, easing: "cubic-bezier(.2,.7,.25,1)" });
    if (!isActive()) return;
    mode = "dialog";
    q("[data-delivery-collect]").disabled = false;
    onDialog();
    q("[data-delivery-collect]").focus({ preventScroll: true });
  }

  root.addEventListener("pointerdown", () => {
    // The stroke or one-click reveal that finished the mask is never the
    // subsequent click that dismisses the revealed item's information.
    reviewPointerStarted = mode === "review";
  }, { capture: true, signal: events.signal });
  root.addEventListener("click", (event) => {
    if (mode !== "review" || (!reviewPointerStarted && !(event.detail === 0 && event.target.closest("[data-delivery-return]")))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    returnToDialog();
  }, { signal: events.signal });

  return {
    get mode() { return mode; },
    prepare() {
      if (mode !== "scratch") return;
      const later = q("[data-delivery-close]");
      later.className = "delivery-skip"; later.textContent = "稍后继续";
      later.setAttribute("aria-label", "稍后继续领取");
      q(".delivery-footer").append(later);
    },
    sync(pending, saving) { if (mode === "scratch" && !pending && !saving) showReview(); },
    returnToDialog,
    dispose() { events.abort(); }
  };
}
