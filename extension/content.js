/** @type {Function} */
let cleanup = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action != "toggle") return;
  if (cleanup) {
    cleanup();
    cleanup = null;
    return;
  }
  cleanup = initialize();
});

const SHADOW_CSS = /* css */ `
:host {
  all: initial !important;
  position: fixed !important;
  inset: 0 !important;
  pointer-events: none !important;
}

:host::backdrop {
  all: initial !important;
}

pre {
  margin: 0;
  color: #fffc;
}

pre:empty {
  display: none;
}

div {
  width: max-content;
  line-height: 20px;
  padding: 0 0.25em;
  transition: opacity 0.5s 2s;
  background: #000d;
}

b {
  color: #fff;
}
`;

/** @type {(keyof WindowEventMap)[]} */
const EVENTS = [
  "click",
  "contextmenu",
  "dblclick",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseup",
  "pointercancel",
  "pointerdown",
  "pointermove",
  "pointerup",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
  "wheel",
];

const EVENTS_BY_COLOR = new Map([
  ["#fb923c", ["click", "dblclick", "contextmenu"]],
  ["#facc15", ["mousedown", "mouseup", "mousemove"]],
  ["#4ade80", ["touchstart", "touchmove", "touchend", "touchcancel"]],
  ["#2dd4bf", ["pointerdown", "pointermove", "pointerup", "pointercancel"]],
  ["#60a5fa", ["keydown", "keyup"]],
  ["#e879f9", ["wheel"]],
]);

const COLOR_BY_EVENT = new Map(
  Array.from(EVENTS_BY_COLOR.entries()).flatMap(([color, events]) =>
    events.map((event) => [event, color])
  )
);

function initialize() {
  const container = document.createElement("div");
  container.popover = "manual";

  const shadow = container.attachShadow({ mode: "closed" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHADOW_CSS);
  shadow.adoptedStyleSheets = [sheet];

  const pre = document.createElement("pre");
  shadow.appendChild(pre);

  document.body.appendChild(container);

  /** @type {WeakSet<Event>} */
  const capturingEvents = new WeakSet();

  const createLine = () => {
    const line = document.createElement("div");
    let count = 0;
    let frame = 0;

    const formatBoolean = (value) =>
      `<span style="color: ${value ? "#4ade80" : "#f87171"}">${value}</span>`;

    /** @param {Event} event */
    const render = (event) => {
      const eventColor = COLOR_BY_EVENT.get(event.type);
      const countStr = count > 1 ? ` x${count}` : "";
      let html = `<b style="color: ${eventColor}">[${event.type}${countStr}]</b>`;

      if (event instanceof PointerEvent) {
        html += ` id=<b>${event.pointerId}</b>`;
        html += ` type=<b style="color: #67e8f9">${event.pointerType}</b>`;
        if (!event.isPrimary) html += ` primary=<b>${formatBoolean(event.isPrimary)}</b>`;
      }

      if (event instanceof WheelEvent) {
        html += ` delta=<b>(${event.deltaX.toFixed(0)}, ${event.deltaY.toFixed(0)})</b>`;
        html += ` mode=<b>${event.deltaMode}</b>`;
      }

      if (event instanceof TouchEvent) {
        html += ` touches=<b>${event.touches.length}</b>`;
      }

      if (event instanceof MouseEvent) {
        let buttons = [];
        if (event.buttons & 1) buttons.push("primary");
        if (event.buttons & 2) buttons.push("secondary");
        if (event.buttons & 4) buttons.push("auxiliary");
        if (event.buttons & 8) buttons.push("fourth");
        if (event.buttons & 16) buttons.push("fifth");
        html += ` pos=<b>(${event.clientX.toFixed(0)}, ${event.clientY.toFixed(0)})</b>`;
        if (buttons.length) html += ` buttons=<b>[${buttons.join(", ")}]</b>`;
      }

      if (event instanceof KeyboardEvent) {
        html += ` code=<b>${event.code}</b>`;
        if (event.repeat) html += ` repeat=<b>${formatBoolean(event.repeat)}</b>`;
        if (event.shiftKey) html += ` shift=<b>${formatBoolean(event.shiftKey)}</b>`;
        if (event.ctrlKey) html += ` ctrl=<b>${formatBoolean(event.ctrlKey)}</b>`;
        if (event.altKey) html += ` alt=<b>${formatBoolean(event.altKey)}</b>`;
        if (event.metaKey) html += ` meta=<b>${formatBoolean(event.metaKey)}</b>`;
        if (event.location) html += ` location=<b>${event.location}</b>`;
      }

      if (capturingEvents.has(event)) {
        html += ` <b style="color: #e879f9">captured</b>`;
      }

      line.innerHTML = html;

      line.style.transition = "none";
      line.style.opacity = "1";
      line.offsetHeight;
      line.style.transition = "";
      line.style.opacity = "0";
    };

    /** @param {Event} event */
    const update = (event) => {
      if (event.eventPhase == Event.CAPTURING_PHASE) count++;

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => render(event));

      return true;
    };

    return { line, update };
  };

  /** @type {Map<string, (event: Event) => boolean>} */
  const updateEventLine = new Map();

  /** @param {Event} event */
  const onEvent = (event) => {
    if (event.eventPhase != Event.CAPTURING_PHASE) {
      capturingEvents.delete(event);
      updateEventLine.get(event.type)?.(event);
      return;
    }

    if (updateEventLine.get(event.type)?.(event)) {
      capturingEvents.add(event);
      return;
    }

    const { line, update } = createLine();

    pre.appendChild(line);
    update(event);

    line.addEventListener("transitionend", () => {
      updateEventLine.delete(event.type);
      line.remove();
    });

    updateEventLine.set(event.type, update);
    capturingEvents.add(event);
  };

  /** @param {Event} event */
  const showPopover = (event) => {
    if (event?.target == container) return;
    // force popover to show on top
    container.hidePopover();
    container.showPopover();
  };

  addEventListener("focusin", showPopover, { capture: true }); // triggered on modal dialogs
  addEventListener("toggle", showPopover, { capture: true }); // other popovers
  document.addEventListener("fullscreenchange", showPopover, { capture: true });
  showPopover();

  for (const event of EVENTS) {
    addEventListener(event, onEvent, { capture: true });
    addEventListener(event, onEvent, { capture: false });
  }

  return () => {
    removeEventListener("focusin", showPopover, { capture: true });
    removeEventListener("toggle", showPopover, { capture: true });
    document.removeEventListener("fullscreenchange", showPopover, { capture: true });

    container.remove();

    for (const event of EVENTS) {
      removeEventListener(event, onEvent, { capture: true });
      removeEventListener(event, onEvent, { capture: false });
    }
  };
}
