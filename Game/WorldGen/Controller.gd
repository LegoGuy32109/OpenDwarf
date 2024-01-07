extends Node2D

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
var currentZoomIndex = 2

var processingMovement: bool = false
var moving: bool = false
var sprinting: bool = false

var tileMoveTime: float = 0.5

var staminaExhaustion: float = 0.0
var staminaMax: float = 100.0
var moveStamCost := 1.0
var restStamAmt := 0.1

# how far to move player character to align on tile size
@onready var playerMovementOnWorld = self.get_parent().TILE_SIZE

# both can be 9 possible values (-1,-1) ... (1,1)
var playerMovement := Vector2i(0, 0)
var reachDirection := Vector2i(0, 0)

@onready var reachIndicator = $ReachIndicator
@onready var exhaustionMeter = $ExhaustionMeter

func _physics_process(_delta):
	if !moving&&staminaExhaustion > 0.0:
		staminaExhaustion = max(staminaExhaustion - restStamAmt, 0.0)
		exhaustionMeter.visible = staminaExhaustion > 0.0

	if staminaExhaustion >= staminaMax:
		tileMoveTime = 0.5
	elif staminaExhaustion < staminaMax:
		tileMoveTime = 0.2
	
	exhaustionMeter.value = staminaExhaustion
	if !processingMovement&&playerMovement != Vector2i(0, 0):
		processMovementRequest()
	
	reachIndicator.position = reachDirection
	if reachDirection != Vector2i(0, 0):
		reachIndicator.visible = true
	else:
		reachIndicator.visible = false

func processMovementRequest() -> void:
	processingMovement = true

	staminaExhaustion += moveStamCost

	moving = true
	var singleTween := create_tween()
	singleTween.tween_property(
		self,
		"position",
		self.position + Vector2(playerMovement),
		tileMoveTime
	)
	await singleTween.finished
	moving = false

	processingMovement = false

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
}

func _unhandled_key_input(event: InputEvent) -> void:
	# event key was just pressed
	if event.is_pressed() && !event.is_echo():
		match event.keycode:
			keyMap.move_up:
				playerMovement.y += - playerMovementOnWorld.y
			keyMap.move_left:
				playerMovement.x += - playerMovementOnWorld.x
			keyMap.move_down:
				playerMovement.y += playerMovementOnWorld.y
			keyMap.move_right:
				playerMovement.x += playerMovementOnWorld.x
			keyMap.reach_up:
				reachDirection.y += - playerMovementOnWorld.y
			keyMap.reach_left:
				reachDirection.x += - playerMovementOnWorld.x
			keyMap.reach_down:
				reachDirection.y += playerMovementOnWorld.y
			keyMap.reach_right:
				reachDirection.x += playerMovementOnWorld.x
			keyMap.toggle_sprint:
				sprinting = !sprinting
	# event key was just pressed, or held down
	if event.is_pressed():
		match event.keycode:
			keyMap.camera_zoom_in:
				currentZoomIndex = clamp(currentZoomIndex - 1, 0, zooms.size() - 1)
				%Camera.zoom = zooms[currentZoomIndex]
			keyMap.camera_zoom_out:
				currentZoomIndex = clamp(currentZoomIndex + 1, 0, zooms.size() - 1)
				%Camera.zoom = zooms[currentZoomIndex]
	elif event.is_released():
		match event.keycode:
			keyMap.move_up:
				playerMovement.y -= - playerMovementOnWorld.y
			keyMap.move_left:
				playerMovement.x -= - playerMovementOnWorld.x
			keyMap.move_down:
				playerMovement.y -= playerMovementOnWorld.y
			keyMap.move_right:
				playerMovement.x -= playerMovementOnWorld.x
			keyMap.reach_up:
				reachDirection.y -= - playerMovementOnWorld.y
			keyMap.reach_left:
				reachDirection.x -= - playerMovementOnWorld.x
			keyMap.reach_down:
				reachDirection.y -= playerMovementOnWorld.y
			keyMap.reach_right:
				reachDirection.x -= playerMovementOnWorld.x
