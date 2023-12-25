extends Node

var zoomAmount = Vector2(0.1, 0.1)
var zoomMin = Vector2(0.3, 0.3)
var zoomMax = Vector2(1.8, 1.8)

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
# can be 9 possible values (-1,-1) ... (1,1)
var playerMovement := Vector2i(0,0)

@onready var nextMoveProgBar = $NextMoveProgress

func _physics_process(_delta):
	if !moving && staminaExhaustion > 0.0: 
		staminaExhaustion = max(staminaExhaustion - restStamAmt, 0.0)
		nextMoveProgBar.visible = staminaExhaustion > 0.0

	if staminaExhaustion >= staminaMax:
		tileMoveTime = 0.5
	elif staminaExhaustion < staminaMax:
		tileMoveTime = 0.2
	
	nextMoveProgBar.value = staminaExhaustion
	if !processingMovement && playerMovement != Vector2i(0,0):
		processMovementRequest()

func processMovementRequest()->void:
	processingMovement = true

	staminaExhaustion += moveStamCost

	moving = true
	var singleTween := create_tween()
	singleTween.tween_property(
		self, "position", self.position + Vector2(playerMovement), tileMoveTime
	)
	await singleTween.finished
	moving = false

	processingMovement = false

var keyMap: Dictionary = {
	"move_up": KEY_E,
	"move_left": KEY_S,
	"move_down": KEY_D,
	"move_right": KEY_F,
	"toggle_sprint": KEY_SHIFT,
	"camera_zoom_in": KEY_COMMA,
	"camera_zoom_out": KEY_PERIOD,
}

func _unhandled_key_input(event: InputEvent) -> void:
	if event.is_pressed():
		match event.keycode:
			keyMap.move_up:
				playerMovement.y = -playerMovementOnWorld.y
			keyMap.move_left:
				playerMovement.x = -playerMovementOnWorld.x
			keyMap.move_down:
				playerMovement.y = playerMovementOnWorld.y
			keyMap.move_right:
				playerMovement.x = playerMovementOnWorld.x
			keyMap.toggle_sprint:
				sprinting = !sprinting
			keyMap.camera_zoom_in:
				%Camera.zoom += zoomAmount
				%Camera.zoom = clamp(%Camera.zoom, zoomMin, zoomMax)
			keyMap.camera_zoom_out:
				%Camera.zoom -= zoomAmount
				%Camera.zoom = clamp(%Camera.zoom, zoomMin, zoomMax)
	elif event.is_released():
		match event.keycode:
			keyMap.move_up:
				playerMovement.y = 0
			keyMap.move_left:
				playerMovement.x = 0
			keyMap.move_down:
				playerMovement.y = 0
			keyMap.move_right:
				playerMovement.x = 0
