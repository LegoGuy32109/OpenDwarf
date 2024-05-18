class_name Creature
extends Node2D
## Basic 'Entity' in the game
##
## Can be controlled by players or operates independantly.

@onready var animator: AnimatedSprite2D = $Frames
# animator.sprite_frames.get_animation_names()

# assigned when instantiated
## reference to tiles for navigation and interaction
var tileManager: TileManager

var brainDisabled: bool = false
var externalController: Controller

var processingMovement: bool = false

const TILE_SIZE = Vector2i(64, 64)

const NO_DIRECTION = Vector2i(0, 0)

var controllerState: ControllerState

var tileCoordinates := Vector2i(0, 0)
var tileMoveTime: float = 0.4

var staminaExhaustion: float = 0.0
var staminaMax: float = 100.0
var moveStamCost := 1.0
var restStamAmt := 0.1

## keep track of current actions being taken
var actions := {}

## When controlled, react based on controller state
func processExternalInput(externalControllerState: ControllerState):
	controllerState = externalControllerState

	# movement logic WASD (ESDF)
	if controllerState.moveVector != NO_DIRECTION and not processingMovement:

		processMovementRequest()

	# stamina logic
	if not actions.has("move") and staminaExhaustion > 0.0:
		staminaExhaustion = max(staminaExhaustion - restStamAmt, 0.0)

	if staminaExhaustion >= staminaMax:
		tileMoveTime = 0.5
	elif staminaExhaustion < staminaMax:
		if controllerState.sprintHeld:
			tileMoveTime = 0.2
		else:
			tileMoveTime = 0.4

## Creature is attempting to move based on moveVector
func processMovementRequest() -> void:
	processingMovement = true

	staminaExhaustion += moveStamCost * 2.5 if controllerState.sprintHeld else moveStamCost

	# input delay for multi-input movement (diagonal)
	if not actions.has("move"):
		await get_tree().create_timer(0.06).timeout

	var moveTween := create_tween()
	var destinationWorldCoordinates = self.position + Vector2(controllerState.moveVector)
	actions["move"] = {
		"startTile": tileManager.getTile(self.position),
		"endTile": tileManager.getTile(destinationWorldCoordinates),
		"moveVector": controllerState.moveVector,
		"tween": moveTween,
		"movementTime": tileMoveTime, # perform calculations if necessary
	}
	moveTween.tween_property(
			self,
			"position",
			destinationWorldCoordinates,
			actions.move.movementTime
	)
	await moveTween.finished

	# could have been interupted since that movement

	tileCoordinates = Vector2i(self.position / Vector2(TILE_SIZE))

	# no movement input detected
	if controllerState.moveVector == NO_DIRECTION:
		actions.erase("move")

	processingMovement = false

## Creature is attempting to preform an action based on a location
func preformAction(globalPosition: Vector2):
	var tile: Tile = tileManager.getTile(globalPosition)
	var actionToPreform: Callable = tileManager.tileAction.bind(self, tile)

	# based on held tool, determine action

	# based on target tile, determine type of action
	if not tile.traversable:
		actionToPreform.call('mine')

func control():
	print("I am being controlled")
	brainDisabled = true

func release():
	print("I am no longer controlled")
	brainDisabled = false
