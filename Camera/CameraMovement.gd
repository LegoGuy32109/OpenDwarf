extends Camera2D
@export
var cameraSpeed : float = 7.0
@export
var zoomAmount : float = 0.1
#NOTE If lag is unbearable, change to move on a grid
func _physics_process(_delta):
	self.global_translate(Vector2(cameraSpeed * \
	(Input.get_action_strength("ui_right") - Input.get_action_strength("ui_left")),\
	cameraSpeed * \
	(Input.get_action_strength("ui_down") - Input.get_action_strength("ui_up"))))

func _unhandled_input(event):
	if event.is_action_pressed("zoom_in") and self.zoom.x < 2.0:
		self.zoom.x += zoomAmount
		self.zoom.y += zoomAmount
		print(self.zoom)
	if event.is_action_pressed("zoom_out") and self.zoom.x > 0.4:
		self.zoom.x += -zoomAmount
		self.zoom.y += -zoomAmount
		print(self.zoom)
	if event.is_action_pressed("ui_accept"):
		get_tree().reload_current_scene()

