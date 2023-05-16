extends Camera2D
@export
var cameraSpeed : float = 7.0
@export
var zoomAmount : float = 0.1
#NOTE If lag is unbearable, change to move on a grid

# what the camera is following, null if user moves manually
var cameraTarget: Node2D = null

func removeCurrentTarget() -> void:
	if cameraTarget:
		cameraTarget.get_node("StateMenu").selected = -1
	cameraTarget = null

func _physics_process(_delta):
	if _getCameraMoveVector().length_squared() > 0:
		removeCurrentTarget()
		
	if(cameraTarget):
		self.position = cameraTarget.position
	elif(not HUD.inMenu):
		self.global_translate(_getCameraMoveVector())

func _getCameraMoveVector() -> Vector2:
	return Vector2(cameraSpeed * \
		(Input.get_action_strength("ui_right") - Input.get_action_strength("ui_left")),\
		cameraSpeed * \
		(Input.get_action_strength("my_down") - Input.get_action_strength("ui_up")))

func _unhandled_input(event):
	if event.is_action_pressed("zoom_in") and self.zoom.x < 2.0:
		self.zoom.x += zoomAmount
		self.zoom.y += zoomAmount

	if event.is_action_pressed("zoom_out") and self.zoom.x > 0.4:
		self.zoom.x += -zoomAmount
		self.zoom.y += -zoomAmount

	if event.is_action_pressed("ui_cancel"):
		HUD.exitDialog()

