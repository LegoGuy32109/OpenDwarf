@icon("res://icon.svg")
@tool

extends Node3D

@export var RUN: bool = false:
	set(value):
		if value:
			runCode()

func runCode() ->void:
#	var totalBoundry: AABB = self.get_children()[0].mesh.get_aabb()
	for child in self.get_children():
		var currentBoundry: AABB = child.mesh.get_aabb()
		print(child.name + str(child.scale) + str(currentBoundry.size))
		# multiplying size arguments ~= get_volume()
		print(currentBoundry.get_volume())
		
#		print(str(currentBoundry.position)+" "+str(currentBoundry.end))
#		assert(str(child.scale) == str(Vector3(1.0, 1.0, 1.0)))
#		totalBoundry.merge(child.mesh.get_aabb())
	
#	print("Hey!!\n"+str(totalBoundry.size))


