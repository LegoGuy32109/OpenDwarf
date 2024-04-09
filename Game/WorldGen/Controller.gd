extends Node
class_name Controller

var zooms = [
	Vector2(1.4, 1.4),
	Vector2(1.2, 1.2),
	Vector2(1.0, 1.0),
	Vector2(0.8, 0.8),
	Vector2(0.7, 0.7),
	Vector2(0.6, 0.6),
	Vector2(0.5, 0.5),
	Vector2(0.4, 0.4),
	Vector2(0.3, 0.3),
]
# default 2
var currentZoomIndex = 2

var currentTileCords := Vector2i(0, 0)

@onready var tileManager: TileManager = %Chunks
# how far to move player character to align on tile size
@onready var TILE_SIZE = %Chunks.TILE_SIZE
@onready var CHUNK_SIZE = %Chunks.CHUNK_SIZE

const NO_DIRECTION = Vector2i(0, 0)

## Creature to control/follow/focus on
var controlledCreature: Creature

## root interaction ui node
@onready var inspector: Node2D = $Inspector

## sprites to indicate interaction
@onready var indicator: AnimatedSprite2D = $Inspector.get_node("Indicator")

## Changeable map to controls
var keyMap: Dictionary = {
	"move_up": KEY_E,
	"move_left": KEY_S,
	"move_down": KEY_D,
	"move_right": KEY_F,
	"reach_up": KEY_I,
	"reach_down": KEY_K,
	"reach_left": KEY_J,
	"reach_right": KEY_L,
	"toggle_sprint": KEY_SHIFT,
	"toggle_crouch": KEY_CTRL,
	"camera_zoom_in": KEY_COMMA,
	"camera_zoom_out": KEY_PERIOD,
	"select": KEY_SPACE,
	"inspector": KEY_G,
	"escape": KEY_ESCAPE,
}

var controllerState = ControllerState.new()

func _ready() -> void:
	inspector.hide()
	%Camera.targetZoom = zooms[currentZoomIndex]

func _process(_delta):
	if controlledCreature:
		inspector.position = Vector2(controlledCreature.tileCoordinates * TILE_SIZE)
		controlledCreature.processExternalInput(controllerState)
	else:
		processWorldPanning()
	
	manageReach()

## Releasing creature
func releaseControl():
	if controlledCreature:
		controlledCreature.release()
		%Camera.removeTarget()
		controlledCreature = null
		inspector.get_node("Indicator").animation = "select"
		inspector.get_node("Indicator").position = Vector2(0, 0)
		inspector.get_node("Indicator").visible = true

func selectChanged(isHeld: bool):
	if controlledCreature:
		if isHeld:
			inspector.show()
			indicator.play("target")
		else:
			indicator.stop()
			indicator.animation = "circle"
	else:
		if isHeld and inspector.visible:
			var inspectorTileCoords = Vector2i(inspector.position) / TILE_SIZE
			var tile: Tile = tileManager.getTile(inspectorTileCoords)
			var creatures = %Creatures.get_children()
			if tile:
				for creature: Creature in creatures:
					if creature.tileCoordinates == tile.coordinates:
						controlledCreature = creature
						%Camera.setTarget(creature)
						inspector.position = Vector2(creature.tileCoordinates)
						indicator.visible = false
						indicator.animation = "circle"
						return

func processWorldPanning():
	if controllerState.moveVector != NO_DIRECTION:
		cameraMove()

func manageReach():
	if controlledCreature:
		if !indicator.is_playing():
			indicator.position = Vector2(controllerState.reachVector)
			if controllerState.reachVector != NO_DIRECTION:
				indicator.visible = true
			else:
				indicator.visible = false
	else:
		if controllerState.reachVector != NO_DIRECTION:
			globalMoveInspector()
		
var processingGlobalInspectorMove = false

func globalMoveInspector():
	if !processingGlobalInspectorMove:
		inspector.position += Vector2(controllerState.reachVector)
		processingGlobalInspectorMove = true
		await get_tree().create_timer(0.1).timeout
		processingGlobalInspectorMove = false

## called when no controlledCreature is being controlled
func cameraMove() -> void:
	var cameraSpeed: float = float(currentZoomIndex + 1) / (100 * zooms.size())
	%Camera.cameraTarget.position += Vector2(controllerState.moveVector) * cameraSpeed

## bring Inspector to center of screen, show if hidden
func focusInspectorCenter() -> void:
	var positionToSnapTo: Vector2 = %Camera.position.snapped(Vector2(TILE_SIZE))
	# hide if double-tapped basically
	if inspector.visible&&inspector.position == positionToSnapTo:
		inspector.hide()
		return

	inspector.position = positionToSnapTo
	inspector.show()

func _unhandled_key_input(event: InputEvent) -> void:
	# event key was just pressed
	if event.is_pressed()&&!event.is_echo():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				controllerState.moveVector.y += - TILE_SIZE.y
			keyMap.move_left:
				controllerState.moveVector.x += - TILE_SIZE.x
			keyMap.move_down:
				controllerState.moveVector.y += TILE_SIZE.y
			keyMap.move_right:
				controllerState.moveVector.x += TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				controllerState.reachVector.y += - TILE_SIZE.y
			keyMap.reach_left:
				controllerState.reachVector.x += - TILE_SIZE.x
			keyMap.reach_down:
				controllerState.reachVector.y += TILE_SIZE.y
			keyMap.reach_right:
				controllerState.reachVector.x += TILE_SIZE.x
			# select
			keyMap.select:
				selectChanged(true)
			# snap inspector to center screen
			keyMap.inspector:
				focusInspectorCenter()
			# sprinting
			keyMap.toggle_sprint:
				controllerState.sprintHeld = !controllerState.sprintHeld
			# escape
			keyMap.escape:
				releaseControl()
	elif event.is_released():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				controllerState.moveVector.y -= - TILE_SIZE.y
			keyMap.move_left:
				controllerState.moveVector.x -= - TILE_SIZE.x
			keyMap.move_down:
				controllerState.moveVector.y -= TILE_SIZE.y
			keyMap.move_right:
				controllerState.moveVector.x -= TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				controllerState.reachVector.y -= - TILE_SIZE.y
			keyMap.reach_left:
				controllerState.reachVector.x -= - TILE_SIZE.x
			keyMap.reach_down:
				controllerState.reachVector.y -= TILE_SIZE.y
			keyMap.reach_right:
				controllerState.reachVector.x -= TILE_SIZE.x
			# select
			keyMap.select:
				selectChanged(false)

	# event key is just pressed OR held down
	if event.is_pressed():
		match event.keycode:
			# camera zoom
			keyMap.camera_zoom_in:
				currentZoomIndex = clamp(currentZoomIndex - 1, 0, zooms.size() - 1)
				%Camera.targetZoom = zooms[currentZoomIndex]
			keyMap.camera_zoom_out:
				currentZoomIndex = clamp(currentZoomIndex + 1, 0, zooms.size() - 1)
				%Camera.targetZoom = zooms[currentZoomIndex]