extends Camera2D

@export
var snappedToTarget: bool = false

@export
var lerpWeight: float = 0.2

@export
var targetZoom: Vector2 = Vector2(0.2, 0.2)

@onready
var cameraTarget: Node2D = Node2D.new()


func _physics_process(_delta):
	if cameraTarget:
		if snappedToTarget:
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


## snap camera to given entity
func setTarget(node: Node2D):
	cameraTarget = node
	# snappedToTarget = true


## unsnap camera from entity, if it existed
func removeTarget():
	snappedToTarget = false
