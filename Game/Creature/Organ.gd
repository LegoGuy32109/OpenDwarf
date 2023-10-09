extends Resource

class_name Organ

# Required variables
@export var id: String # connects it to template
@export var name: String
@export var volume: float = 1.0
@export var material: String = "flesh" # will be class soon
@export var weight: float = 1.0

# Right now, OpenDwarf creatures have to be directional non-cyclical
@export var primaryConnection: Connection
# leadsTo organs that are external, or completely cover the current organ
@export var externalConnections: Array[Connection]
# leadsTo organs that are internal
@export var internalConnections: Array[Connection]

# Optional variables
@export var skin: String = ""
@export var limbName: String = ""
@export var fat: float = 0.0
@export var hair: Array[String] = []
@export var isHeart: bool = false
#@export var items: Array[Item] = [] # Will contain bones for Organs

# Autocompleted variables
@export var isInternal: bool = false
@export var needsBlood: bool = false

## Must contain an id in params
func _init(params: Dictionary):
	id = params.id
	name = params.id # will be overwritten if exists in pramas
	
	var propList = self.get_property_list().map(
		func (prop: Dictionary): return prop.name
	)
	for prop in propList:
		if params.has(prop):
			self.set(prop, params[prop])
	
	primaryConnection = null

func getInfo(all: bool = false) -> Dictionary:
	var allInfo: Dictionary = {
		"id": id,
		"name": name,
		"limbName": limbName,
		"volume": volume,
		"material": material,
		"weight": weight,
		"isHeart": isHeart,
		"isInternal": isInternal,
		"needsBlood": needsBlood,
	}
	if not all:
		for key in allInfo.keys():
			if (allInfo[key] is bool and allInfo[key] == false) \
				or (allInfo[key] is String and allInfo[key] == ""):
				allInfo.erase(key)
	return allInfo

func getAllConnections() -> Array[Connection]:
	var allConnections = externalConnections.duplicate()
	allConnections.append_array(internalConnections)
	return allConnections

# I would love to have creatures with two brains, not right now
func isBrain() -> bool:
	return primaryConnection == null

func terminates() -> bool:
	return externalConnections.is_empty() and internalConnections.is_empty()

# Will identify if Organ is an internal Organ, and save result
func findIfInternal() -> bool:
	var _isInternal: bool = false
	
	# edge case if organ is brain, must have been set in body creation
	if (primaryConnection == null):
		return isInternal
	else:
		for conection in primaryConnection.linkFrom.internalConnections:
			if (conection.linkTo == self):
				_isInternal = true
	isInternal = _isInternal
	return isInternal

func getAllInternalOrgans() -> Array[Organ]:
	var internalOrgans = internalConnections.map(
		func (connec: Connection): return connec.linkTo
	)
	if primaryConnection.linkFrom.isInternal:
		internalOrgans.append(primaryConnection.linkFrom)
	return internalOrgans

# Attach a Organ, making this Organ the parent
func connectOrgan(_organ: Organ, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _organ, _vesselInfo)
	externalConnections.append(connection)

# Attach a 'internal' organ
func connectInternalOrgan(_organ: Organ, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _organ, _vesselInfo)
	internalConnections.append(connection)
	_organ.isInternal = true


