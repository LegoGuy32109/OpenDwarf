extends Resource

class_name Connection

# connection vessels, each pathway a float 1.0 - 0.0
@export var vessels: Dictionary = {}

@export var linkFrom: Organ # dominant organ
@export var linkTo: Organ # submissive organ

enum TYPE {EXTERNAL, INTERNAL, MAGIC}
@export var type: TYPE = TYPE.EXTERNAL

# Connections must be made to link two organs together, they cannot be created without two organs. ~Losing a organ will make that connection cease to exist~
# Actually the connection will still exist, the organ will return null to indicate blood should be shooting everywhere
func _init(_linkFrom: Organ, _linkTo: Organ, connectionData: Dictionary = {}):
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
		
		# make sure this is being passed as an int, not a string
		if connectionData.has("type"):
			type = connectionData.type
		
		if vessels.has("artery") && vessels.artery > 0.0:
			linkFrom.needsBlood = true
			linkTo.needsBlood = true

func getInfo(all: bool = false):
	var infoObj = vessels
	infoObj["type"] = TYPE.keys()[type]
	# by default, don't include values that are false or 0.0
	if not all:
		for key in infoObj.keys():
			if (infoObj[key] is float and infoObj[key] == 0.0) \
				or (infoObj[key] is bool and infoObj[key] == false):
				infoObj.erase(key)
	return infoObj
