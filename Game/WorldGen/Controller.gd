extends Node

# class_name Controller

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

var currentTileCords := Vector2i(0,0)
var tileMoveTime: float = 0.5

var staminaExhaustion: float = 0.0
var staminaMax: float = 100.0
var moveStamCost := 1.0
var restStamAmt := 0.1

# how far to move player character to align on tile size
@onready var TILE_SIZE = self.get_parent().TILE_SIZE
#TODO this should be in a Class.TILE_SIZE like World.TILE_SIZE or something...

const NO_DIRECTION = Vector2i(0, 0)
# both can be 9 possible values (-1,-1) ... (1,1)
var moveVector := NO_DIRECTION
var reachDirection := NO_DIRECTION

signal selectStatusChanged(held: bool)
var selectHeld := false

## Entity to control/follow/focus on
var entity: Node2D
@onready var reachIndicator = $ReachIndicator
@onready var exhaustionMeter = $ExhaustionMeter

func _ready() -> void:
	%Camera.targetZoom = zooms[currentZoomIndex]
	selectStatusChanged.connect(selectChanged)

func _physics_process(_delta):
	if entity:
		processEntityMovement()
	else:
		processManageMovement()

func selectChanged(held: bool):
	if entity:
		pass
		# TODO implement process action on reachIndicator for entity
	else:
		if held:
			$Inspector.position = %Camera.position.snapped(Vector2(TILE_SIZE))

func processManageMovement():
	# camera move logic WASD (ESDF)
	if moveVector != NO_DIRECTION:
		cameraMove()

func processEntityMovement():
	# movement logic WASD (ESDF)
	if moveVector != NO_DIRECTION && !processingMovement:
		processMovementRequest()

	# stamina logic
	if exhaustionMeter:
		if !moving && staminaExhaustion > 0.0:
			staminaExhaustion = max(staminaExhaustion - restStamAmt, 0.0)
			exhaustionMeter.visible = staminaExhaustion > 0.0

		if staminaExhaustion >= staminaMax:
			tileMoveTime = 0.5
		elif staminaExhaustion < staminaMax:
			if sprinting:
				tileMoveTime = 0.2
			else:
				tileMoveTime = 0.4

		exhaustionMeter.value = staminaExhaustion

	# reaching logic IJKL
	if reachIndicator:
		reachIndicator.global_position = currentTileCords * TILE_SIZE + reachDirection
		if reachDirection != NO_DIRECTION:
			reachIndicator.visible = true
		else:
			reachIndicator.visible = false

## called when moving an entity
func processMovementRequest() -> void:
	processingMovement = true

	staminaExhaustion += moveStamCost if sprinting else moveStamCost/2.5

	# input delay for diagonal movement
	if !moving:
		await get_tree().create_timer(0.06).timeout

	moving = true
	var singleTween := create_tween()
	singleTween.tween_property(
		entity,
		"position",
		entity.position + Vector2(moveVector),
		tileMoveTime
	)
	await singleTween.finished

	# could have been interupted since that movement

	currentTileCords = Vector2i( entity.position / Vector2(TILE_SIZE) )

	# no movement input detected
	if moveVector == NO_DIRECTION:
		moving = false

	processingMovement = false

## called when no entity is being controlled
func cameraMove() -> void:
	var cameraSpeed: float = float(currentZoomIndex+1)/zooms.size()
	%Camera.position += Vector2(moveVector) * cameraSpeed

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
}

func _unhandled_key_input(event: InputEvent) -> void:
	# event key is just pressed or held down
	if event.is_pressed():
		match event.keycode:
			keyMap.camera_zoom_in:
				currentZoomIndex = clamp(currentZoomIndex - 1, 0, zooms.size() - 1)
				%Camera.targetZoom = zooms[currentZoomIndex]
			keyMap.camera_zoom_out:
				currentZoomIndex = clamp(currentZoomIndex + 1, 0, zooms.size() - 1)
				%Camera.targetZoom = zooms[currentZoomIndex]
	# event key was just pressed
	if event.is_pressed() && !event.is_echo():
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
			# reachDirection
			keyMap.reach_up:
				reachDirection.y += - TILE_SIZE.y
			keyMap.reach_left:
				reachDirection.x += - TILE_SIZE.x
			keyMap.reach_down:
				reachDirection.y += TILE_SIZE.y
			keyMap.reach_right:
				reachDirection.x += TILE_SIZE.x
			# select
			keyMap.select:
				selectStatusChanged.emit(true)
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
			# reachDirection
			keyMap.reach_up:
				reachDirection.y -= - TILE_SIZE.y
			keyMap.reach_left:
				reachDirection.x -= - TILE_SIZE.x
			keyMap.reach_down:
				reachDirection.y -= TILE_SIZE.y
			keyMap.reach_right:
				reachDirection.x -= TILE_SIZE.x
			# select
			keyMap.select:
				selectStatusChanged.emit(false)
