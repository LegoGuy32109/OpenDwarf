extends Camera2D

@export
var snapToTarget : bool = false

@export
var lerpWeight : float = 0.2

@onready 
var cameraTarget: Node2D = %Entity

func _physics_process(_delta):
	if snapToTarget:
		self.position = cameraTarget.position
	elif (self.position.distance_squared_to(cameraTarget.position) > 1):
		self.position = self.position.lerp(cameraTarget.position, lerpWeight)
