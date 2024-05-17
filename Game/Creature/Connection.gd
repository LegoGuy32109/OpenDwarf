extends Resource

class_name Connection

# connection vessels, each pathway a float 1.0 - 0.0
@export var vessels: Dictionary = {}

@export var linkFrom: Organ # dominant organ
@export var linkTo: Organ # submissive organ

enum Type {EXTERNAL, INTERNAL, INSIDE_OF, MAGIC}
@export var type: Type = Type.EXTERNAL

# Connections must be made to link two organs together, they cannot be created without two organs. ~Losing a organ will make that connection cease to exist~
# Actually the connection will still exist, the organ will return null to indicate blood should be shooting everywhere
func _init(_linkFrom: Organ, _linkTo: Organ, connectionData: Dictionary={}):
	linkFrom = _linkFrom
	
	_linkTo.primaryConnection = self
	linkTo = _linkTo
	
	# Default case, these two organs are attached by material alone
	if connectionData.is_empty():
		vessels.tissue = 1.0
	else:
		var newVesselInfo: Array = connectionData.keys()
		for vesselName in newVesselInfo:
			if connectionData[vesselName] is float:
				vessels[vesselName] = connectionData[vesselName]
		
		if connectionData.has("type"):
			assert(
				connectionData.type is int or connectionData.type is String,
				"incorrect type for 'type', looking for int or string."
			)
			# check if passing enum or string
			if connectionData.type is int:
				type = connectionData.type
			elif connectionData.type is String:
				# determine enum value by converting type label to uppercase
				var enumName = connectionData.type.to_upper()
				type = Type[enumName]
		
		if vessels.has("artery")&&vessels.artery > 0.0:
			linkFrom.needsBlood = true
			linkTo.needsBlood = true

## Return info about the connection itself as a Dictionary
func getInfo() -> Dictionary:
	var infoObj := {}
	infoObj.vessels = vessels
	infoObj["type"] = Type.keys()[type].to_lower()
	return infoObj
