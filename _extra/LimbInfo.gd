@tool

extends Node3D
## Traverse a group of 3D meshes to define volume for a creature's [Organ]s
##
## Goes through each direct child of this node, aquiring the [AABB] boundry
## and dimensions of the [Organ]. All organs are rectangular prisims, so
## this should be accurate. All child meshes MUST be normalized, make sure
## scale was applied `Ctrl+A` if importing your .glb from Blender.
##

@export_file("*.json") var filePath: String = "res://_extra/human_male.json"

@export var SaveFile: bool = false:
	set(_value):
		saveFile()
		
@export var ReadFile: bool = false:
	set(_value):
		readFile()

@export_group("Make new JSON file in _extra")
@export var fileName: String = "new_template.json";
@export var MakeFile: bool = false:
	set(_value):
		makeFile()

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
	file.close()

func saveFile() ->void:
	var outputObj: Dictionary = {}
	
	for child in self.get_children():
		var currentBoundry: AABB = child.mesh.get_aabb()
		assert(str(child.scale) == str(Vector3(1.0, 1.0, 1.0)), "%s has incorrect scaling: %s" % [child.name, child.scale])
		# multiplying size arguments ~== get_volume()-
		outputObj[child.name] = {
			"volume": currentBoundry.get_volume(), 
			"size":currentBoundry.size,
		}
	
	var output: String = JSON.stringify(outputObj, "	")
	
	var file = FileAccess.open(filePath, FileAccess.WRITE)
	file.store_string(output)
	file.close()

func makeFile():
	var file = FileAccess.open("res://_extra/%s" % fileName, FileAccess.WRITE)
	file.store_string("{}")
	file.close()
