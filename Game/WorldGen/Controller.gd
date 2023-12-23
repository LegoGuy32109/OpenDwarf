extends CharacterBody2D

var zoomAmount = Vector2(0.1, 0.1)
var zoomMin = Vector2(0.1, 0.1)
var zoomMax = Vector2(2, 2)

var moving: bool = false
var sprinting: bool = false

# how far to move player character to align on tile size
@onready var playerMovementOnWorld = self.get_parent().TILE_SIZE
# can be 9 possible values (-1,-1) ... (1,1)
var playerMovement := Vector2i(0,0)

func _process(_delta: float) -> void:
	if !moving && playerMovement != Vector2i(0,0):
		processMovementRequest()

func processMovementRequest()->void:
	moving = true
	var singleTween := create_tween()
	singleTween.tween_property(
		self, "position", self.position + Vector2(playerMovement), 0.02 if sprinting else 0.3
	)
	await singleTween.finished
	moving = false

func _unhandled_key_input(event: InputEvent) -> void:
	if event.is_pressed():
		match event.keycode:
			KEY_W:
				playerMovement.y = -playerMovementOnWorld.y
			KEY_A:
				playerMovement.x = -playerMovementOnWorld.x
			KEY_S:
				playerMovement.y = playerMovementOnWorld.y
			KEY_D:
				playerMovement.x = playerMovementOnWorld.x
			KEY_SHIFT:
				sprinting = !sprinting
			KEY_COMMA:
				%Camera.zoom += zoomAmount
				%Camera.zoom = clamp(%Camera.zoom, zoomMin, zoomMax)
			KEY_PERIOD:
				%Camera.zoom -= zoomAmount
				%Camera.zoom = clamp(%Camera.zoom, zoomMin, zoomMax)
	elif event.is_released():
		match event.keycode:
			KEY_W:
				playerMovement.y = 0
			KEY_A:
				playerMovement.x = 0
			KEY_S:
				playerMovement.y = 0
			KEY_D:
				playerMovement.x = 0
