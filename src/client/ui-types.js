// @ts-check
// The types of the UI layer: a layout, its elements, and the view it is made from.

/** @typedef {{x:number,y:number,w:number,h:number}} Rect */
/** @typedef {{top:number,right:number,bottom:number,left:number}} Insets */
/** @typedef {import('../shared/hearing-log.js').HearingLine} HearingLine */
/** @typedef {import('../shared/shop.js').ShopRow} ShopRow */
/** @typedef {import('../shared/items.js').Stack} Stack */

/**
 * One UI element. `kind` says how it draws; `hit` makes it take pointers;
 * `blocks` makes it hide the world and elements below from pointers without
 * acting. `act` says when a hit acts: on pointer down (buttons), on release
 * without a drag (rows in a scrolling list), or on release (fullscreen, which
 * the browser lets start only from a release).
 * @typedef {object} UiElement
 * @property {string} id
 * @property {"scrim"|"panel"|"text"|"button"|"round"|"stick"|"slot"|"row"|"key"|"chatbar"|"line"|"image"|"icon"|"zone"} kind
 * @property {Rect} rect
 * @property {boolean} [hit]
 * @property {boolean} [blocks]
 * @property {boolean} [round] the hit area is the circle inside `rect`
 * @property {"down"|"tap"|"release"|"stick"} [act]
 * @property {string} [scroll] the scroll list a drag on this element moves
 * @property {string} [text]
 * @property {string} [color] a palette name
 * @property {"left"|"center"|"right"} [align]
 * @property {number} [scale] glyph scale in CSS pixels per font pixel
 * @property {string} [glyph] a drawn symbol: "x", "fullscreen", "bag", "sprint", "item"
 * @property {string} [item] an item kind to draw
 * @property {number} [count]
 * @property {boolean} [on] a toggled button, or the selected row or slot
 * @property {boolean} [held] the slot of the held item
 * @property {boolean} [dim]
 * @property {boolean} [locked]
 * @property {number} [fill] a 0 to 1 bar, such as stamina
 * @property {string} [key] the keyboard action: a character or a named key
 * @property {string} [name] the name of a row (its shop row key)
 * @property {number} [speaker] characters at the start of `text` that name a speaker
 * @property {string} [sub] a second text, such as a price
 * @property {string} [sub2] a third text, such as a count
 * @property {number} [cx] circle center
 * @property {number} [cy]
 * @property {number} [r]
 */

/**
 * What the layout needs to know. Everything is optional except the size.
 * @typedef {object} UiView
 * @property {number} width the canvas width in CSS pixels
 * @property {number} height
 * @property {Insets} [safe] safe-area insets in CSS pixels
 * @property {number} [scale] the UI scale setting, 1 to 2
 * @property {number} [dpr] device pixels per CSS pixel
 * @property {boolean} [touch] touch controls and the in-game keyboard apply
 * @property {string|null} [loading] the loading screen text, or null
 * @property {string} [status]
 * @property {string} [displayStatus]
 * @property {string} [update] the stale-build notice; a tap reloads the page
 * @property {string|null} [diagnostics] the F3 panel text, or null when closed
 * @property {string|null} [zoom] the level and zoom text, or null
 * @property {boolean} [fullscreen] show the fullscreen button
 * @property {boolean} [fullscreenOn]
 * @property {{tools:boolean,players:number,joinOpen:boolean,qr:boolean,offline?:boolean}} [host]
 * @property {string} [held] the held item kind
 * @property {{value:number,on:boolean,locked:boolean}} [stamina]
 * @property {{open:boolean,pressed?:boolean}} [logButton]
 * @property {boolean} [bagOpenButton]
 * @property {{move:Knob,look:Knob}} [sticks]
 * @property {{open:boolean,draft:string,page:"letters"|"symbols",shift:boolean}} [chat]
 * @property {{open:boolean,page:string,scale:number,textSize:string,sizes:readonly string[],voices?:string,voiceLevels?:readonly string[],music?:string,musicLevels?:readonly string[],effects?:string,effectsLevels?:readonly string[],mode:string,build?:string,audio?:string}} [menu]
 * @property {{open:boolean,lines:readonly HearingLine[],scroll:number}} [log]
 * @property {{open:boolean,stacks:readonly Stack[],selected:number,held:string}} [bag]
 * @property {{open:boolean,rows:readonly ShopRow[],selected:string,scroll:number}} [shop]
 * @property {{open:boolean,status:string,stats:string,items:readonly {id:string}[]}} [sessions]
 */
/** @typedef {{active:boolean,x:number,y:number}} Knob the knob offset from the stick center in CSS pixels */

/**
 * @typedef {object} UiLayout
 * @property {number} width
 * @property {number} height
 * @property {number} ts CSS pixels per font pixel
 * @property {number} k device pixels per font pixel
 * @property {UiElement[]} elements in draw order
 * @property {Map<string,UiElement>} byId
 * @property {Rect} safeRect
 * @property {{x:number,y:number,w:number,h:number,capacity:number}|null} shopList
 * @property {{capacity:number,total:number,scroll:number}|null} logList
 * @property {number} controlsTop
 * @property {number|null} chatTop the top of the in-game keyboard and chat line, or null while none shows
 */
