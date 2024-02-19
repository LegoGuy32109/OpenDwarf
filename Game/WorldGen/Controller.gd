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

var processingMovement: bool = false
var moving: bool = false
var sprinting: bool = false

var currentTileCords := Vector2i(0, 0)
var tileMoveTime: float = 0.4

var staminaExhaustion: float = 0.0
var staminaMax: float = 100.0
var moveStamCost := 1.0
var restStamAmt := 0.1

@onready var tileManager: TileManager = %Chunks
# how far to move player character to align on tile size
@onready var TILE_SIZE = %Chunks.TILE_SIZE
@onready var CHUNK_SIZE = %Chunks.CHUNK_SIZE

const NO_DIRECTION = Vector2i(0, 0)
# both can be 9 possible values (-1,-1) ... (1,1) * TILE_SIZE
var moveVector := NO_DIRECTION
var reachVector := NO_DIRECTION

var selectHeld := false

## Creature to control/follow/focus on
var controlledCreature: Creature

func _ready() -> void:
	$Inspector.hide()
	%Camera.targetZoom = zooms[currentZoomIndex]

func _physics_process(_delta):
	if controlledCreature:
		controlledCreature.processMovement()
	else:
		processManageMovement()

func selectChanged(isHeld: bool):
	if controlledCreature:
		if isHeld:
			controlledCreature.release()
			controlledCreature = null
	else:
		if isHeld and $Inspector.visible:
			var tileCords = Vector2i($Inspector.position) / TILE_SIZE
			var tile: Tile = tileManager.getTile(tileCords)
			var creatures = %Creatures.get_children()
			if tile:
				# This needs to be of type Creature at somepoint, whatever is under Entities node
				for creature: Creature in creatures:
					if creature.tileCoordinates == tile.coordinates:
						controlledCreature = creature
						%Camera.setTarget(creature)
						var indicator: AnimatedSprite2D = $Inspector.get_node("Indicator")
						indicator.animation = "circle"
						return

func processManageMovement():
	# camera move logic WASD (ESDF)
	if moveVector != NO_DIRECTION:
		cameraMove()

func manageReach():
	if reachVector != NO_DIRECTION:
		# TODO add dampening logic like movement
		$Inspector.position += Vector2(reachVector)

## called when no controlledCreature is being controlled
func cameraMove() -> void:
	var cameraSpeed: float = float(currentZoomIndex + 1) / zooms.size()
	%Camera.cameraTarget.position += Vector2(moveVector) * cameraSpeed

## bring Inspector to center of screen, show if hidden
func focusInspectorCenter() -> void:
	var positionToSnapTo: Vector2 = %Camera.cameraTarget.position.snapped(Vector2(TILE_SIZE))
	# hide if double-tapped basically
	if $Inspector.visible&&$Inspector.position == positionToSnapTo:
		$Inspector.hide()
		return

	$Inspector.position = positionToSnapTo
	$Inspector.show()

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

func _unhandled_key_input(event: InputEvent) -> void:
	# event key was just pressed
	if event.is_pressed()&&!event.is_echo():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				moveVector.y += - TILE_SIZE.y
			keyMap.move_left:
				moveVector.x += - TILE_SIZE.x
			keyMap.move_down:
				moveVector.y += TILE_SIZE.y
			keyMap.move_right:
				moveVector.x += TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				reachVector.y += - TILE_SIZE.y
			keyMap.reach_left:
				reachVector.x += - TILE_SIZE.x
			keyMap.reach_down:
				reachVector.y += TILE_SIZE.y
			keyMap.reach_right:
				reachVector.x += TILE_SIZE.x
			# select
			keyMap.select:
				selectChanged(true)
			# snap inspector to center screen
			keyMap.inspector:
				focusInspectorCenter()
			# sprinting
			keyMap.toggle_sprint:
				sprinting = !sprinting
	elif event.is_released():
		match event.keycode:
			# moveVector
			keyMap.move_up:
				moveVector.y -= - TILE_SIZE.y
			keyMap.move_left:
				moveVector.x -= - TILE_SIZE.x
			keyMap.move_down:
				moveVector.y -= TILE_SIZE.y
			keyMap.move_right:
				moveVector.x -= TILE_SIZE.x
			# reachVector
			keyMap.reach_up:
				reachVector.y -= - TILE_SIZE.y
			keyMap.reach_left:
				reachVector.x -= - TILE_SIZE.x
			keyMap.reach_down:
				reachVector.y -= TILE_SIZE.y
			keyMap.reach_right:
				reachVector.x -= TILE_SIZE.x
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
