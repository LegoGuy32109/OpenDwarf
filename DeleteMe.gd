extends Node2D

func _ready():
	# This causes weird lag in the camera movement, 
	await get_tree().create_timer(10).timeout
	self.queue_free()
