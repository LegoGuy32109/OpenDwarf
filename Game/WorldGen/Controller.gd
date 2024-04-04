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

# var processingMovement: bool = false
# var moving: bool = false
# var sprinting: bool = false

var currentTileCords := Vector2i(0, 0)
# var tileMoveTime: float = 0.4

# var staminaExhaustion: float = 0.0
# var staminaMax: float = 100.0
# var moveStamCost := 1.0
# var restStamAmt := 0.1

@onready var tileManager: TileManager = %Chunks
# how far to move player character to align on tile size
@onready var TILE_SIZE = %Chunks.TILE_SIZE
@onready var CHUNK_SIZE = %Chunks.CHUNK_SIZE

const NO_DIRECTION = Vector2i(0, 0)

## Creature to control/follow/focus on
var controlledCreature: Creature

## Changeable map to controls
var keyMap: Dictionary = {
	"move_up": KEY_E,
	"move_left": KEY_S,
	"move_down": KEY_D,
	"move_right": KEY_F,
	"reach_up": KEY_I,
	"reach_left": KEY_J,
	"reach_down": KEY_K,
	"reach_right": KEY_L,
	"toggle_sprint": KEY_SHIFT,
	"toggle_crouch": KEY_CTRL,
	"camera_zoom_in": KEY_COMMA,
	"camera_zoom_out": KEY_PERIOD,
	"select": KEY_SPACE,
	"inspector": KEY_G,
}

## Fed to controlled creatures
# TODO make this a class for type hints
var controllerState: Dictionary = {
	"move_vector": Vector2i(0, 0),
	"reach_vector": Vector2i(0, 0),
	"sprint_held": false,
	"crouch_held": false,
	"select_held": false
}

func _ready() -> void:
	$Inspector.hide()
	%Camera.targetZoom = zooms[currentZoomIndex]

func _physics_process(_delta):
	if controlledCreature:
		# $Inspector.position = Vector2(controlledCreature.tileCoordinates)
		controlledCreature.processExternalInput(controllerState)
	else:
		processWorldPanning()

func selectChanged(isHeld: bool):
	if controlledCreature:
		if isHeld:
			controlledCreature.release()
			%Camera.removeTarget()
			controlledCreature = null
			$Inspector.get_node("Indicator").animation = "select"
			$Inspector.get_node("Indicator").position = $Inspector.position
			$Inspector.get_node("Indicator").visible = true
	else:
		if isHeld and $Inspector.visible:
			var inspectorTileCoords = Vector2i($Inspector.position) / TILE_SIZE
			var tile: Tile = tileManager.getTile(inspectorTileCoords)
			var creatures = %Creatures.get_children()
			if tile:
				for creature: Creature in creatures:
					if creature.tileCoordinates == tile.coordinates:
						controlledCreature = creature
						%Camera.setTarget(creature)
						$Inspector.position = Vector2(creature.tileCoordinates)
						$Inspector.get_node("Indicator").visible = false
						$Inspector.get_node("Indicator").animation = "circle"
						return

func processWorldPanning():
	# camera move logic WASD (ESDF)
	if controllerState.move_vector != NO_DIRECTION:
		cameraMove()

func manageReach():
	if controlledCreature:
		$Inspector.get_node("Indicator").position = $Inspector.position + Vector2(controllerState.reach_vector)
		if controllerState.reach_vector != NO_DIRECTION:
			$Inspector.get_node("Indicator").visible = true
		else:
			$Inspector.get_node("Indicator").visible = false
	else:
		if controllerState.reach_vector != NO_DIRECTION:
			# TODO add dampening logic like movement
			$Inspector.position += Vector2(controllerState.reach_vector)

## called when no controlledCreature is being controlled
func cameraMove() -> void:
	var cameraSpeed: float = float(currentZoomIndex + 1) / zooms.size()
	%Camera.cameraTarget.position += Vector2(controllerState.move_vector) * cameraSpeed

## bring Inspector to center of screen, show if hidden
func focusInspectorCenter() -> void:
	var positionToSnapTo: Vector2 = %Camera.position.snapped(Vector2(TILE_SIZE))
	# hide if double-tapped basically
	if $Inspector.visible&&$Inspector.position == positionToSnapTo:
		$Inspector.hide()
		return

	$Inspector.position = positionToSnapTo
	$Inspector.show()

func _unhandled_key_input(event: InputEvent) -> void:
	# event key was just pressed
	if event.is_pressed()&&!event.is_echo():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				controllerState.move_vector.y += - TILE_SIZE.y
			keyMap.move_left:
				controllerState.move_vector.x += - TILE_SIZE.x
			keyMap.move_down:
				controllerState.move_vector.y += TILE_SIZE.y
			keyMap.move_right:
				controllerState.move_vector.x += TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				controllerState.reach_vector.y += - TILE_SIZE.y
			keyMap.reach_left:
				controllerState.reach_vector.x += - TILE_SIZE.x
			keyMap.reach_down:
				controllerState.reach_vector.y += TILE_SIZE.y
			keyMap.reach_right:
				controllerState.reach_vector.x += TILE_SIZE.x
			# select
			keyMap.select:
				selectChanged(true)
			# snap inspector to center screen
			keyMap.inspector:
				focusInspectorCenter()
			# sprinting
			keyMap.toggle_sprint:
				controllerState.sprint_held = !controllerState.sprint_held
	elif event.is_released():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				controllerState.move_vector.y -= - TILE_SIZE.y
			keyMap.move_left:
				controllerState.move_vector.x -= - TILE_SIZE.x
			keyMap.move_down:
				controllerState.move_vector.y -= TILE_SIZE.y
			keyMap.move_right:
				controllerState.move_vector.x -= TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				controllerState.reach_vector.y -= - TILE_SIZE.y
			keyMap.reach_left:
				controllerState.reach_vector.x -= - TILE_SIZE.x
			keyMap.reach_down:
				controllerState.reach_vector.y -= TILE_SIZE.y
			keyMap.reach_right:
				controllerState.reach_vector.x -= TILE_SIZE.x
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
			# reaching notification
			keyMap.reach_right, keyMap.reach_down, keyMap.reach_up, keyMap.reach_left:
				manageReach()
