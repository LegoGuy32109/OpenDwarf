extends Resource

class_name Organ

# Required variables
@export var organId: String # connects it to template
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
@export var fat: float = 0.0
@export var hair: Array[String] = []
@export var isHeart: bool = false
#@export var items: Array[Item] = [] # Will contain bones for Organs

# Autocompleted variables
@export var isInternal: bool = false
@export var needsBlood: bool = false
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}
## 0: NONE, 1: CONNETCED, 2: DISCONNECTED
@export var currentHeartConnection: ConnectionToHeart = ConnectionToHeart.NONE

# Organ must be named
#func _init( 
#		_organId: String, \
#		_name: String, \
#		_volume: float = 1.0, \
#		_material: String = "flesh", \
#		_weight: float = 1.0):
func _init(params: Dictionary):
	organId = params.id
	name = params.id # will be overwritten if exists in pramas
	
	var propList = self.get_property_list().map(
		func (prop: Dictionary): return prop.name
	)
	for prop in propList:
		if params.has(prop):
			self.set(prop, params[prop])
	
	primaryConnection = null

func getInfo() -> Dictionary:
	return {
		"organId": organId,
		"name": name,
		"volume": volume,
		"material": material,
		"weight": weight,
		"isHeart": isHeart,
		"isInternal": isInternal,
		"needsBlood": needsBlood,
	}

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

# Find out if Organ is in artery network
# returns connectionToHeart enum
func connectedToHeart() -> ConnectionToHeart:
	# If you don't have an artery (you're possibly an extremity), who cares?
	if (primaryConnection && primaryConnection.vessels.artery == 0.0):
		# check if this was set to true before...
		if(needsBlood):
			# returning this at creature creation IS AN ERROR
			return ConnectionToHeart.DISCONNECTED
		needsBlood = false
		return ConnectionToHeart.NONE
	
	# run connectedToHeart on every Artery Organ so we can confirm \
	needsBlood = true # will stay false if it doesn't need blood
	
	# find brain of the body
	var brain: Organ = self
	while (brain.primaryConnection):
		# the brain needs to be connected to the arteryNetwork, 
		# at least for humanoids idk
		assert(brain.primaryConnection.vessels.artery > 0.0, \
				name+" needs artery connection to heart")
		brain = brain.primaryConnection.linkFrom
	
	var network = brain.findArteryNetwork()
	var numHeartsInNetwork: int = 0
	for organ in network:
		if organ.isHeart:
			numHeartsInNetwork += 1
	
	if (numHeartsInNetwork >= 1): # required amounts of hearts for creature?
		return ConnectionToHeart.CONNECTED
	else:
		return ConnectionToHeart.DISCONNECTED

func getAllInternalOrgans() -> Array[Organ]:
	var internalOrgans = internalConnections.map(
		func (connec: Connection): return connec.linkTo
	)
	if primaryConnection.linkFrom.isInternal:
		internalOrgans.append(primaryConnection.linkFrom)
	return internalOrgans

# Get Organs connected by Arteries
func findArteryNetwork(arteryNetwork: Array[Organ] = []):
	var allConnections := externalConnections
	allConnections.append_array(internalConnections)
	for connection in allConnections:
		if (connection.vessels.artery > 0.0):
			var arteryOrgan = connection.linkTo
			arteryNetwork.append(arteryOrgan)
			arteryOrgan.findArteryNetwork(arteryNetwork)
	return arteryNetwork

# Attach a Organ, making this Organ the parent
func connectOrgan(_organ: Organ, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _organ, _vesselInfo)
	externalConnections.append(connection)

# Attach a 'internal' organ
func connectInternalOrgan(_organ: Organ, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _organ, _vesselInfo)
	internalConnections.append(connection)


