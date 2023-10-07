@icon("res://icon.svg")
@tool

extends Node3D


@export var filePath: String = "res://_extra/human_male.json"

@export var SaveFile: bool = false:
	set(_value):
		saveFile()
		
@export var ReadFile: bool = false:
	set(_value):
		readFile()

func readFile() ->void:
	var file = FileAccess.open(filePath, FileAccess.READ)
	var inputObj: Dictionary = {}
	var regex = RegEx.new()
	regex.compile("(\\d*\\.?\\d*)\\w")
	
	inputObj = JSON.parse_string(file.get_as_text())
	
	for key in inputObj.keys():
		var stringSize: String = inputObj[key].size
		# find float in vector3 string
		var vectorParams: Array = regex.search_all(stringSize).map(
			func (rmatch: RegExMatch): return rmatch.get_string().to_float()
		)
		var freshV3 = Vector3(vectorParams[0], vectorParams[1], vectorParams[2])
		inputObj[key].size = freshV3
	
	print(inputObj.Brain.size.z)
	
func saveFile() ->void:
	var outputObj: Dictionary = {}
	
	for child in self.get_children():
		var currentBoundry: AABB = child.mesh.get_aabb()
		assert(str(child.scale) == str(Vector3(1.0, 1.0, 1.0)), "%s has incorrect scaling: %s" % [child.name, child.scale])
		# multiplying size arguments ~== get_volume()-
		outputObj[child.name] = {
			"volume": currentBoundry.get_volume(), 
			"size":currentBoundry.size
		}
	
	var output = JSON.stringify(outputObj, "	")
	
	print("=====\nOrgan Information\n=====")
	print(output)
	
	var file = FileAccess.open(filePath, FileAccess.WRITE)
	
	file.store_string(output)
	file.close()
