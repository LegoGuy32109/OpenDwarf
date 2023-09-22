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

# You've created the brain
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

# _init with a Connection parameter first
# You've created a normal limb


# I would love to have creatures with two brains, not right now
func isBrain() -> bool:
	return primaryConnection == null

func terminates() -> bool:
	return connections.is_empty()

# Just attach a limb, no other nerves
func connectLimb(_limb: Limb, ) -> void:
	var connection = Connection.new(self, _limb)
	connections.append(connection)

