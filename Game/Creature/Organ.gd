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
# leadsTo other organs
@export var connections: Array[Connection]

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

## Return attributes of organ, not it's connection, as a Dictionary
func getInfo(all: bool = false) -> Dictionary:
	var allInfo: Dictionary = {
		"name": name,
		"id": id,
		"limbName": limbName,
		"volume": volume,
		"material": material,
		"weight": weight,
		"isHeart": isHeart,
		"isInternal": isInternal,
		"needsBlood": needsBlood,
	}
	# if not returning 'all' info, don't include attributes that are false or empty
	if not all:
		for key in allInfo.keys():
			if (allInfo[key] is bool and allInfo[key] == false) \
					or (allInfo[key] is String and allInfo[key] == ""):
				allInfo.erase(key)
	return allInfo

## Will identify if Organ is an internal Organ, and save result
func findIfInternal() -> bool:
	var _isInternal: bool = false
	
	# edge case if organ is brain, must have been set in body creation
	if (primaryConnection == null):
		return isInternal
	else:
		for connection in primaryConnection.linkFrom.connections:
			if (connection.type == Connection.TYPE.INTERNAL and connection.linkTo == self):
				_isInternal = true
	isInternal = _isInternal
	return isInternal

## Identify all internal Organs one level down the tree
func getAllInternalOrgans() -> Array[Organ]:
	var internalOrgans = connections.reduce(
		func (intOrgans: Array[Organ], connec: Connection): 
			if connec.type == Connection.TYPE.INTERNAL:
				intOrgans.append(connec.linkTo)
	, [])

	# check if parent organ is inside this organ
	if primaryConnection.type == Connection.TYPE.INSIDE_OF:
		internalOrgans.append(primaryConnection.linkFrom)
	return internalOrgans

## Attach a Organ
func connectOrgan(_organ: Organ, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _organ, _vesselInfo)
	connections.append(connection)
