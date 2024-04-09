extends Node2D

const TILE_SIZE = Vector2i(64, 64)
const NO_DIRECTION = Vector2i(0, 0)

@onready var indicator: AnimatedSprite2D = $Indicator
@onready var exhaustionMeter: ProgressBar = $ExhaustionMeter
@onready var progressBar: PackedScene = preload("res://Game/HUD/progressBar.tscn")
@onready var progressContainer: VBoxContainer = %ProgressContainer
@onready var debugLabel: RichTextLabel = %Label

var waitUntilMove = 0.5
var currentLoc = Vector2(0, 0)

var timers: Dictionary = {}



var controllerState: ControllerState = ControllerState.new()

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

func _process(_delta: float) -> void:
	debugLabel.text = controllerState.to_string()
	processMovement()
	manageReach()
	updateTimers()

func updateTimers():
	for timerName in timers:
		var dataObject = timers[timerName]
		dataObject.bar.value = 100 * (dataObject.timer.get_time_left() / dataObject.timer.get_wait_time())

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
				# selectChanged(true)
				pass
			# snap inspector to center screen
			keyMap.inspector:
				# focusInspectorCenter()
				pass
			# sprinting
			keyMap.toggle_sprint:
				controllerState.sprintHeld = !controllerState.sprintHeld
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
				# selectChanged(false)
				pass

func manageReach():
	if controllerState.reachVector != NO_DIRECTION:
		indicator.visible = true;
		indicator.position = Vector2(controllerState.reachVector)
	else:
		indicator.visible = false;

func processMovement():
	if controllerState.moveVector != NO_DIRECTION:
		if !timers.has("step"):
			startTimer()
			self.position += Vector2(controllerState.moveVector)

func startTimer():
	var newTimer: Timer = Timer.new()
	var newBar: TextureProgressBar = progressBar.instantiate()
	newBar.modulate = "#FFFFFF"
	self.add_child(newTimer)
	progressContainer.add_child(newBar)
	newTimer.connect("timeout", func(): 
		newBar.queue_free()
		newTimer.queue_free()
		timers.erase("step")
	)
	timers["step"] = {}
	timers["step"].timer = newTimer
	timers["step"].bar = newBar
	timers["step"].timer.start(waitUntilMove)
