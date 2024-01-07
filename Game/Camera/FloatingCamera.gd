extends Camera2D

@export
var snapToTarget: bool = false

@export
var lerpWeight: float = 0.2

@export
var targetZoom: Vector2 = Vector2(1.0, 1.0)

@onready
var cameraTarget: Node2D = %Entity

func _physics_process(_delta):
	if snapToTarget:
		self.position = cameraTarget.position
	elif (self.position.distance_squared_to(cameraTarget.position) > 1):
		self.position = self.position.lerp(cameraTarget.position, lerpWeight)

	if self.zoom != targetZoom:
		_changeZoom()

## interpolate camera zoom from current to target
func _changeZoom():
	var diffVector = targetZoom - self.zoom
	if diffVector.length_squared() > 0.00003:
		var newZoom = self.zoom + diffVector * 0.1
		self.zoom = newZoom.snapped(Vector2(0.002, 0.002)) 
	else:
		self.zoom = targetZoom