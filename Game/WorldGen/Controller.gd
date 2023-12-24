extends Node

var zoomAmount = Vector2(0.1, 0.1)
var zoomMin = Vector2(0.3, 0.3)
var zoomMax = Vector2(2, 2)

var moving: bool = false
var sprinting: bool = false

var moveTimer: Timer = Timer.new()
var waitAfterMove: float = 0.7
var tileMoveTime: float = 0.2

# how far to move player character to align on tile size
@onready var playerMovementOnWorld = self.get_parent().TILE_SIZE
# can be 9 possible values (-1,-1) ... (1,1)
var playerMovement := Vector2i(0,0)

func _process(_delta: float) -> void:
	if !moving && playerMovement != Vector2i(0,0):
		processMovementRequest()
	
	# if !moveTimer.is_stopped():
	# 	set

func processMovementRequest()->void:
	moving = true
	# input delay, I can move diagonally from rest
	await get_tree().create_timer(0.05).timeout
	
	var moveWait = 0.75
	moveTimer.wait_time = moveWait
	moveTimer.start()

	var singleTween := create_tween()
	singleTween.tween_property(
		self, "position", self.position + Vector2(playerMovement), tileMoveTime
	)
	await singleTween.finished

	$NextMoveProgress.value = singleTween.get_total_elapsed_time()
	# await moveTimer.timeout
	moving = false

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
