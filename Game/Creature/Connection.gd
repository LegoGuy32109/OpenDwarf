extends Resource

class_name Connection

# connection vessels, each pathway a float 1.0 - 0.0
@export var vessels: Dictionary = { 
	"tissue": 0.0,
	"muscle": 0.0,
	"nerve": 0.0,
	"artery": 0.0,
	"magic": 0.0
}
@export var linkFrom: Organ # dominant organ
@export var linkTo: Organ # submissive organ

# To explain why "tissue" could be "a soulful arua"
@export var isMagic: bool = false

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
		var vesselInfo: Array = connectionData.keys()
		for vesselName in vesselInfo: 
			vessels[vesselName] = connectionData[vesselName]
