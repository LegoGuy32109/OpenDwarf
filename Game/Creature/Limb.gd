extends Resource

class_name Limb

# Required variables
@export var name: String
@export var weight: float
@export var material: String # material will be class
@export var volume: float

# Right now, OpenDwarf creatures have to be directional non-cyclical
@export var primaryConnection: Connection
@export var connections: Array[Connection]
@export var internalConnections: Array[Connection]

# Optional variables
@export var skin: String = ""
@export var fat: float = 0.0
@export var hair: Array[String] = []
@export var isHeart: bool = false
#@export var items: Array[Item] = [] # Will contain bones for Limbs

# Autocompleted variables
@export var isOrgan: bool = false
@export var needsBlood: bool = false
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}
@export_enum("NONE", "CONNECTED", "DISCONNECTED") var currentHeartConnection: int

# Limb must be named
func _init(
		_name: String, \
		_weight: float = 1.0, \
		_material: String = "flesh", \
		_volume: float = 1.0
		):
	name = _name
	weight = _weight
	material = _material
	volume = _volume
	
	primaryConnection = null
	connections = []


# I would love to have creatures with two brains, not right now
func isBrain() -> bool:
	return primaryConnection == null

func terminates() -> bool:
	return connections.is_empty()

# Will identify if limb is an internal limb, and save result
func findIfOrgan() -> bool:
	var _isOrgan: bool = false
	
	# edge case if organ is brain, check through lower connections
	if (primaryConnection == null):
		for connection in connections:
			for potentialConec in connection.linkTo.internalConnections:
				if (potentialConec.linkFrom == self):
					_isOrgan = true
	else:
		for conection in primaryConnection.linkFrom.internalConnections:
			if (conection.linkTo == self):
				_isOrgan = true
	isOrgan = _isOrgan
	return isOrgan

# Find out if limb is in artery network
# returns connectionToHeart enum
func connectedToHeart() -> int:
	# If you don't have an artery (you're possibly an extremity), who cares?
	if (primaryConnection && primaryConnection.vessels.artery == 0.0):
		# check if this was set to true before...
		if(needsBlood):
			# returning this at creature creation IS AN ERROR
			return ConnectionToHeart.DISCONNECTED
		needsBlood = false
		return ConnectionToHeart.NONE
	
	# run connectedToHeart on every Artery Limb so we can confirm \
	needsBlood = true # will stay false if it doesn't need blood
	
	# find brain of the body
	var brain: Limb = self
	while (brain.primaryConnection):
		# the brain needs to be connected to the arteryNetwork, 
		# at least for humanoids idk
		assert(brain.primaryConnection.vessels.artery > 0.0)
		brain = brain.primaryConnection.linkFrom
	
	var network = brain.findArteryNetwork()
	var numHeartsInNetwork: int = 0
	for limb in network:
		if limb.isHeart:
			numHeartsInNetwork += 1
	
	if (numHeartsInNetwork >= 1): # required amounts of hearts for creature?
		return ConnectionToHeart.CONNECTED
	else:
		return ConnectionToHeart.DISCONNECTED

# Get limbs connected by Arteries
func findArteryNetwork(arteryNetwork: Array[Limb] = []):
	for connection in connections:
		if (connection.vessels.artery > 0.0):
			var arteryLimb = connection.linkTo
			arteryNetwork.append(arteryLimb)
			arteryLimb.findArteryNetwork(arteryNetwork)
	return arteryNetwork

# Attach a limb, making this limb the parent
func connectLimb(_limb: Limb, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _limb, _vesselInfo)
	connections.append(connection)

# Attach a 'internal' limb
func connectOrgan(_limb: Limb, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _limb, _vesselInfo)
	connections.append(connection)
	internalConnections.append(connection)

# Called from a brain, that will be an internal parent of given limb
func isBrainOf(_limb: Limb, _vesselInfo: Dictionary = {}) -> void:
	var connection = Connection.new(self, _limb, _vesselInfo)
	connections.append(connection)
	_limb.internalConnections.append(connection)


