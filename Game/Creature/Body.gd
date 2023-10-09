extends Resource

class_name Body

# Brain of the creature
var rootOrgan: Organ
# Organs covered in skin, or visible to air...
var externalOrgans: Array[Organ]
# Organs ...
var internalOrgans: Array[Organ]

enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}

## Construct a Body from a chain of limbs, or a template
func _init(params: Dictionary) -> void:
	# constructing from a chain of limbs, starting with brain or "root"
	if params.has("rootOrgan"):
		rootOrgan = params.rootOrgan
		_traverseBody(rootOrgan)
	
	# constructing from json object, not existing organ resources
	else:
		rootOrgan = _constructBodyFromObj(params)
		if (rootOrgan.isInternal):
			internalOrgans.push_front(rootOrgan)


## returns false if object failed
func _constructBodyFromObj(obj: Dictionary)->Organ:
	var organInfo = obj.duplicate()
	organInfo.erase("connections")
	
	var organ: Organ = Organ.new(organInfo)
	
	if obj.has("connections"):
		if obj.connections.has("internal"):
			for connection in obj.connections.internal:
				var childOrgan: Organ = _constructBodyFromObj(connection.organ)
				organ.connectInternalOrgan(childOrgan, connection.connection)
				internalOrgans.push_back(childOrgan)
		if obj.connections.has("external"):
			for connection in obj.connections.external:
				var childOrgan: Organ = _constructBodyFromObj(connection.organ)
				organ.connectOrgan(childOrgan, connection.connection)
				externalOrgans.push_back(childOrgan)
	return organ

func getAllOrgans():
	var allOrgans = externalOrgans.duplicate()
	allOrgans.append_array(internalOrgans)
	return allOrgans

## Find all hearts in the body
func getAllHearts()->Array[Organ]:
	var hearts: Array[Organ] = []
	var allOrgans = externalOrgans.duplicate()
	allOrgans.append_array(internalOrgans)
	for organ in allOrgans:
		if organ.isHeart:
			hearts.push_back(organ)
	return hearts

## Lists in decending order
func getExternalOrgansByVolume():
	var sortedOrgans = externalOrgans.duplicate()
	sortedOrgans.sort_custom(
		func(organA: Organ, organB: Organ): return organA.volume > organB.volume
	)
	return sortedOrgans

## Must be ran in initialization from rootOrgan if chain of limbs
func _traverseBody(organ: Organ):
	if (organ.findIfInternal()):
		internalOrgans.push_back(organ)
	else:
		externalOrgans.push_back(organ)
	for connection in organ.getAllConnections():
		_traverseBody(connection.linkTo)

func getGraph(withVolume: bool = false, organ: Organ = rootOrgan, levelsDeep = 0) -> String:
	var buildLog: String = ""
	if (levelsDeep == 0):
		buildLog += "Legend\nBRAIN 🧠\nORGAN 🫁\nHEART 🫀\nNEEDS BLOOD 🩸\n"
	
	var depth = ""
	for i in range(levelsDeep):
		depth += "-"
	
	var isBrain = ""
	if(levelsDeep == 0):
		isBrain = "🧠"
	
	var isOrgan = ""
	if organ.isInternal:
		isOrgan = "🫁"
	
	var isHeart = ""
	if(organ.isHeart):
		isHeart = "🫀"
	
	var bloodMessage = ""
	match (getBloodStatus(organ)):
		ConnectionToHeart.CONNECTED:
			bloodMessage = "🩸"
		# Just a normal organ
		ConnectionToHeart.NONE:
			bloodMessage = ""
		ConnectionToHeart.DISCONNECTED:
			bloodMessage="❌🩸"
		var newCase:
			bloodMessage=" UNCHECKED ConnectionToHeart case: %s" % newCase
			printerr("%s: %s" % [organ.name, bloodMessage])
	
	buildLog += "\n%s%s %s%s%s%s" % \
		[depth, organ.name, isBrain, isHeart, isOrgan, bloodMessage]
	
	if withVolume:
		buildLog += "\n%s%s m^3" % [depth, organ.volume]
		buildLog += "\n%s%s cm^3\n" % [depth, organ.volume*1_000_000]
	
	for connection in organ.getAllConnections():
		buildLog += getGraph(withVolume, connection.linkTo, levelsDeep+1)
	
	return buildLog

## TODO traverse artery networks
func getBloodStatus(organ: Organ)-> ConnectionToHeart:
	return ConnectionToHeart.NONE
