extends Node2D
class_name Creature

@onready var animator: AnimatedSprite2D = $Frames
# animator.sprite_frames.get_animation_names()

# needs to grab Tiles group for path finding
# @onready var tileManager : TileManager = %Chunks

var brainDisabled : bool = false
var externalController: Controller

var processingMovement: bool = false
var moving: bool = false
# var sprinting: bool = false

const TILE_SIZE = Vector2i(64, 64)

const NO_DIRECTION = Vector2i(0, 0)

var controllerState: Dictionary = {}

var tileCoordinates := Vector2i(0, 0)
var tileMoveTime: float = 0.4

var staminaExhaustion: float = 0.0
var staminaMax: float = 100.0
var moveStamCost := 1.0
var restStamAmt := 0.1


## When controlled, react based on controller state
func processExternalInput(externalControllerState: Dictionary):
	controllerState = externalControllerState

	# movement logic WASD (ESDF)
	if controllerState.move_vector != NO_DIRECTION && !processingMovement:
		processMovementRequest()

	# stamina logic
	if !moving && staminaExhaustion > 0.0:
		staminaExhaustion = max(staminaExhaustion - restStamAmt, 0.0)
		# exhaustionMeter.visible = staminaExhaustion > 0.0

	if staminaExhaustion >= staminaMax:
		tileMoveTime = 0.5
	elif staminaExhaustion < staminaMax:
		if controllerState.sprint_held:
			tileMoveTime = 0.2
		else:
			tileMoveTime = 0.4

		# exhaustionMeter.value = staminaExhaustion

	# TODO handle indicators on controller level, not entity. Feed entity locations
	# reaching logic IJKL
	# if reachIndicator:
	# 	reachIndicator.global_position = tileCoordinates * TILE_SIZE + reachVector
	# 	if reachVector != NO_DIRECTION:
	# 		reachIndicator.visible = true
	# 	else:
	# 		reachIndicator.visible = false


func processMovementRequest() -> void:
	processingMovement = true

	staminaExhaustion += moveStamCost if controllerState.sprint_held else moveStamCost / 2.5

	# input delay for diagonal movement
	if !moving:
		await get_tree().create_timer(0.06).timeout

	moving = true
	var singleTween := create_tween()
	singleTween.tween_property(
		self, "position", self.position + Vector2(controllerState.move_vector), tileMoveTime
	)
	await singleTween.finished

	# could have been interupted since that movement

	tileCoordinates = Vector2i(self.position / Vector2(TILE_SIZE))

	# no movement input detected
	if controllerState.move_vector == NO_DIRECTION:
		moving = false

	processingMovement = false

func control():
	print("I am being controlled")
	brainDisabled = true

func release():
	print("I am no longer controlled")
	brainDisabled = false
