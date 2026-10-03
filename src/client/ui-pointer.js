// @ts-check

import { hitTest, stickVector } from "./ui.js";

/**
 * Routes pointer events over the UI layout. It keeps today's input rules:
 * every pointer is tracked on its own, so several fingers work at once; a
 * button acts when its pointer goes down, because iOS sends no click while
 * another finger is down; each stick follows one pointer; and a pointer that
 * starts on no element belongs to the world, which is where pinch and
 * two-finger level drags work.
 *
 * It holds no DOM. `app.js` feeds it pointer events as plain objects.
 */

/** A drag longer than this many CSS pixels scrolls a list instead of tapping. */
export const DRAG_SLOP = 8;

/** @typedef {import('./ui.js').UiElement} UiElement */
/** @typedef {import('./ui.js').UiLayout} UiLayout */
/** @typedef {{id:number,x:number,y:number}} PointerPoint */

/**
 * @typedef {object} Tracked
 * @property {UiElement} element
 * @property {number} startX
 * @property {number} startY
 * @property {number} lastY
 * @property {boolean} moved
 */

/**
 * @param {object} options
 * @param {()=>UiLayout} options.layout the layout for the current frame
 * @param {(element:UiElement)=>void} options.onAction a button was pressed
 * @param {(element:UiElement)=>void} [options.onRelease] a pressed button's pointer lifted
 * @param {(stick:string,state:{x:number,y:number,knobX:number,knobY:number,active:boolean})=>void} options.onStick
 * @param {(list:string,pixels:number)=>void} options.onScroll
 */
export function createPointerRouter(
  { layout, onAction, onRelease, onStick, onScroll },
) {
  /** @type {Map<number,Tracked>} */
  const tracked = new Map();
  /** The pointer that holds each stick. @type {Map<string,number>} */
  const sticks = new Map();

  /** @param {Tracked} entry @param {number} x @param {number} y */
  function updateStick(entry, x, y) {
    const { element } = entry;
    const size = (element.r ?? 1) * 2;
    const vector = stickVector(
      x - (element.cx ?? 0),
      y - (element.cy ?? 0),
      size,
    );
    onStick(element.id, { ...vector, active: true });
  }

  return {
    /**
     * A pointer went down. Returns "ui" when an element took it and "world"
     * when it landed on nothing, so the caller starts world gestures only for
     * the second.
     * @param {PointerPoint} point @returns {"ui"|"world"}
     */
    down(point) {
      const element = hitTest(layout(), point.x, point.y);
      if (!element) return "world";
      if (tracked.has(point.id)) return "ui";
      if (element.act === "stick") {
        if (sticks.has(element.id)) return "ui";
        const entry = {
          element,
          startX: point.x,
          startY: point.y,
          lastY: point.y,
          moved: false,
        };
        tracked.set(point.id, entry);
        sticks.set(element.id, point.id);
        updateStick(entry, point.x, point.y);
        return "ui";
      }
      if (element.act) {
        tracked.set(point.id, {
          element,
          startX: point.x,
          startY: point.y,
          lastY: point.y,
          moved: false,
        });
      }
      if (element.act === "down") onAction(element);
      return "ui";
    },
    /** @param {PointerPoint} point */
    move(point) {
      const entry = tracked.get(point.id);
      if (!entry) return;
      if (entry.element.act === "stick") {
        updateStick(entry, point.x, point.y);
        return;
      }
      if (!entry.element.scroll) return;
      if (
        !entry.moved &&
        Math.hypot(point.x - entry.startX, point.y - entry.startY) <= DRAG_SLOP
      ) return;
      entry.moved = true;
      onScroll(entry.element.scroll, entry.lastY - point.y);
      entry.lastY = point.y;
    },
    /**
     * A pointer lifted or was cancelled. A cancelled pointer never acts.
     * @param {PointerPoint} point @param {boolean} [cancelled]
     */
    up(point, cancelled = false) {
      const entry = tracked.get(point.id);
      if (!entry) return;
      tracked.delete(point.id);
      const { element } = entry;
      if (element.act === "stick") {
        sticks.delete(element.id);
        onStick(element.id, {
          x: 0,
          y: 0,
          knobX: 0,
          knobY: 0,
          active: false,
        });
        return;
      }
      if (element.act === "down") {
        onRelease?.(element);
        return;
      }
      if (cancelled || entry.moved) return;
      if (element.act === "tap") onAction(element);
      if (element.act === "release") {
        const now = hitTest(layout(), point.x, point.y);
        if (now?.id === element.id) onAction(element);
      }
    },
    /**
     * A wheel turn over a scrolling list. Returns whether a UI element took it.
     * @param {number} x @param {number} y @param {number} pixels
     */
    wheel(x, y, pixels) {
      const element = hitTest(layout(), x, y);
      if (!element) return false;
      if (element.scroll) onScroll(element.scroll, pixels);
      return true;
    },
    /** The ids of the elements held down now, for the pressed look. */
    pressed() {
      /** @type {Set<string>} */
      const ids = new Set();
      for (const entry of tracked.values()) ids.add(entry.element.id);
      return ids;
    },
    /** @param {number} id */
    has(id) {
      return tracked.has(id);
    },
    /** Let go of everything, as when the page loses focus. */
    releaseAll() {
      for (const id of [...tracked.keys()]) {
        this.up({ id, x: 0, y: 0 }, true);
      }
    },
  };
}
