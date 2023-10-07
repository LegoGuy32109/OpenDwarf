extends Resource

class_name Body

# Brain of the creature
var rootOrgan: Organ
# Organs covered in skin, or visible to air...
var externalOrgans: Array[Organ]
# Organs ...
var internalOrgans: Array[Organ]

## Construct a Body from a chain of limbs, or a template
func _init(params: Dictionary, printToConsole = false) -> void:
	# constructing from a chain of limbs, starting with brain or "root"
	if params.has("rootOrgan"):
		rootOrgan = params.rootOrgan
		var buildLog = _traverseBody(rootOrgan)
		if (printToConsole):
			print(buildLog)
		return
	
	# constructing from template parameters
	print(params)

func getAllOrgans():
	var allOrgans = externalOrgans.duplicate()
	allOrgans.append_array(internalOrgans)
	return allOrgans

func getExternalOrgansByVolume():
	var sortedOrgans = externalOrgans.duplicate()
	sortedOrgans.sort_custom(
		func(organA: Organ, organB: Organ): return organA.volume > organB.volume
	)
	return sortedOrgans

func _traverseBody(organ: Organ, levelsDeep = 0) -> String:
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
	if(organ.findIfInternal()):
		isOrgan = "🫁"
		internalOrgans.push_back(organ)
	else:
		externalOrgans.push_back(organ)
	
	var isHeart = ""
	if(organ.isHeart):
		isHeart = "🫀"
	
	var needsBlood = ""
	organ.currentHeartConnection = organ.connectedToHeart()
	match (organ.currentHeartConnection):
		Organ.ConnectionToHeart.CONNECTED:
			needsBlood = "🩸"
		# Just a normal organ
		Organ.ConnectionToHeart.NONE:
			needsBlood = ""
		Organ.ConnectionToHeart.DISCONNECTED:
			needsBlood="❌🩸"
		var newCase:
			needsBlood=" UNCHECKED ConnectionToHeart case: %s" % newCase
			printerr("%s: %s" % [organ.name, needsBlood])
	
	buildLog += "\n%s%s %s%s%s%s" % \
		[depth, organ.name, isBrain, isHeart, isOrgan, needsBlood]
	buildLog += "\n%s%s m^3" % [depth, organ.volume]
	buildLog += "\n%s%s cm^3\n" % [depth, organ.volume*1_000_000]
	
	for connection in organ.connections:
		buildLog += _traverseBody(connection.linkTo, levelsDeep+1)
	
	return buildLog

