@icon("res://icon.svg")
@tool

extends Node3D

@export var RUN: bool = false:
	set(value):
		if value:
			runCode()

func runCode() ->void:
	for child in self.get_children():
		var currentBoundry: AABB = child.mesh.get_aabb()
		print("%s %s %s" % [child.name, child.scale, currentBoundry.size])
		# multiplying size arguments ~== get_volume()
		print(currentBoundry.get_volume())

