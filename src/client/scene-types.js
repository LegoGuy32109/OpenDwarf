// @ts-check
// Scene contract shared by rendering and client features.
/** @typedef {import('../shared/world.js').World} World */
/** @typedef {import('../shared/visibility.js').Visibility} Visibility */
/** @typedef {import('../shared/chat.js').TextSize} TextSize */
/** @typedef {{world:World,localId:string,menu:boolean,menuPage:string,uiScale:number,zoom:number,viewZ:number,viewMode:"entity"|"master",inputMode:string,hudUntil:number,touchGesture:boolean,visibility:Visibility,camera:{x:number,y:number},aim:{x:number,y:number},renderOffset:{x:number,y:number,z:number},presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatFeed:import('../shared/chat.js').DisplayChatRecord[],textSize:TextSize,chatOpen:boolean,chatDraft:string,status:string,notice?:{text:string,until:number},ui?:{layout:import('./ui-types.js').UiLayout,state:import('./ui-types.js').DrawState},mining?:{id:string,x:number,y:number,z:number,progress:number}[],items?:import('../shared/items.js').DroppedEntry[],pickupCells?:import('./pickup-grid.js').GridCell[],layout?:"room"|"test"}} Scene */

export {};
