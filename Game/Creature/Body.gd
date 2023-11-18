extends Resource

class_name Body

# Brain of the creature
var rootOrgan: Organ
# Organs could be internal, external, even magic!
var organs: Array[Organ]

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

## Recursively traverse a body tree converting Dictionary/Object -> Organs 
func _constructBodyFromObj(obj: Dictionary)->Organ:
	var organInfo = obj.duplicate()
	organInfo.erase(XMLData.NODE_FIELD)
	organInfo.erase(XMLData.CHILDREN_FIELD)
	
	var organ: Organ = Organ.new(organInfo)
	
	if obj.has(XMLData.CHILDREN_FIELD):
		for child in obj[XMLData.CHILDREN_FIELD]:
			if child[XMLData.NODE_FIELD] == "connection":
				# extract connection information
				var connectionInfo = child.duplicate()
				connectionInfo.erase(XMLData.NODE_FIELD)
				connectionInfo.erase(XMLData.CHILDREN_FIELD)
				# create a vessel object containing necessary info to make a connection
				child[XMLData.CHILDREN_FIELD].reduce(
					func(vessels, connecChild): 
						if connecChild[XMLData.NODE_FIELD] == "vessel":
							vessels[connecChild.name] = float(connecChild.value)
						return vessels
				, {})
				
				# create child organ to connect in connection
				# should return an array with onr element, if not throw error
				var connectionOrganChildren = \
						child[XMLData.CHILDREN_FIELD].filter(
							func(connecChild): return connecChild[XMLData.NODE_FIELD] == "organ"
						)
				if connectionOrganChildren.is_empty():
					printerr("Connection does not have organ")
					return
				var childOrgan: Organ = _constructBodyFromObj(connectionOrganChildren[0])
				
				# create connection with connection info and child organ
				organ.connectOrgan(childOrgan, connectionInfo)
	
	organs.push_back(organ)
	return organ

## return all information about the body in an organ tree
func _saveBodyToObj(organ: Organ = rootOrgan)->Dictionary:
	var outputObj := {}
	outputObj = organ.getInfo()
	outputObj[XMLData.NODE_FIELD] = "organ"
	
	if not organ.connections.is_empty():
		outputObj[XMLData.CHILDREN_FIELD] = []
		for connection in organ.connections:
			var connectionObj = connection.getInfo()
			connectionObj[XMLData.NODE_FIELD] = "connection"
			connectionObj[XMLData.CHILDREN_FIELD] = []
			# convert vessels into children for connection
			for vesselName in connectionObj.vessels.keys():
				var vesselObj = {
					"name" = vesselName,
					"value" = connectionObj.vessels[vesselName],
				}
				vesselObj[XMLData.NODE_FIELD] = "vessel"
				connectionObj[XMLData.CHILDREN_FIELD].push_back(vesselObj)
			# remove duplicate vessel information
			connectionObj.erase("vessels")
			# get connections' linkTo organ information
			connectionObj[XMLData.CHILDREN_FIELD].push_back(_saveBodyToObj(connection.linkTo))
			outputObj[XMLData.CHILDREN_FIELD].push_back(connectionObj)
	
	return outputObj

## Find all hearts in the body
func getAllHearts()->Array[Organ]:
	var hearts: Array[Organ] = []
	for organ in organs:
		if organ.isHeart:
			hearts.push_back(organ)
	return hearts

## Lists in decending order
func getOrgansByVolume():
	var sortedOrgans = organs.duplicate()
	sortedOrgans.sort_custom(
		func(organA: Organ, organB: Organ): return organA.volume > organB.volume
	)
	return sortedOrgans

## Must be ran in initialization from rootOrgan if chain of limbs
func _traverseBody(organ: Organ):
	organ.findIfInternal() ## TODO might need to remove this, uneccesary. 
	organs.push_back(organ)
	for connection in organ.connections:
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
	## hard coded right now, will fix later
	if (not organ.primaryConnection):
		return ConnectionToHeart.CONNECTED
	
	if (organ.primaryConnection.vessels.has("artery")):
		if organ.primaryConnection.vessels.artery > 0.0:
			return ConnectionToHeart.CONNECTED
		else:
			return ConnectionToHeart.DISCONNECTED
	return ConnectionToHeart.NONE
