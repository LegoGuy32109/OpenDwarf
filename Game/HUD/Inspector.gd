extends Node2D

const TILE_SIZE = Vector2i(64, 64)
const NO_DIRECTION = Vector2i(0, 0)

@onready var indicator = $Indicator
@onready var exhaustionMeter = $ExhaustionMeter

var controllerState: Dictionary = {
	"move_vector": Vector2i(0, 0),
	"reach_vector": Vector2i(0, 0),
	"sprint_held": false,
	"crouch_held": false,
	"select_held": false
}

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
	%Label.text = JSON.stringify(controllerState)

func _unhandled_key_input(event: InputEvent) -> void:
	# event key was just pressed
	print(event)
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
				# selectChanged(true)
				pass
			# snap inspector to center screen
			keyMap.inspector:
				# focusInspectorCenter()
				pass
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
				# selectChanged(false)
				pass

	# event key is just pressed OR held down
	# if event.is_pressed():
	# 	match event.keycode:
			# camera zoom
			# keyMap.camera_zoom_in:
			# 	currentZoomIndex = clamp(currentZoomIndex - 1, 0, zooms.size() - 1)
			# 	%Camera.targetZoom = zooms[currentZoomIndex]
			# keyMap.camera_zoom_out:
			# 	currentZoomIndex = clamp(currentZoomIndex + 1, 0, zooms.size() - 1)
			# 	%Camera.targetZoom = zooms[currentZoomIndex]
			# reaching notification
# 			keyMap.reach_right, keyMap.reach_down, keyMap.reach_up, keyMap.reach_left:
# 				manageReach()

# func manageReach():
# 		self.position = self.position + Vector2(controllerState.reach_vector)