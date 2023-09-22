extends Resource

class_name Connection

# connection pathways
@export var tissue: float = 0.0
@export var muscle: float = 0.0
@export var nerve: float = 0.0
@export var artery: float = 0.0
@export var magic: float = 0.0

@export var linkFrom: Limb # dominant limb
@export var linkTo: Limb # submissive limb

# Connections must be made to link two limbs together, they cannot be created without two limbs. ~Losing a limb will make that connection cease to exist~
# Actually the connection will still exist, the limb will return null to indicate blood should be shooting everywhere
func _init(_linkFrom: Limb, _linkTo: Limb, connectionData: Dictionary = {}):
	linkFrom = _linkFrom
	
	_linkTo.primaryConnection = self
	linkTo = _linkTo
	
	tissue = 1.0
