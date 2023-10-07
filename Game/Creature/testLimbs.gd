extends Node

# this will be fixed in next release
#const Constants = preload("res://Game/Creature/Organ.gd")
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}

# Function must be run after attaching organs together to autocomplete variables
func completeBody(brain: Organ) -> Body:
	var body = Body.new({"rootOrgan": brain}, true)
	return body

# returns root of body, "brain" 🧠
func constructHuman() -> Organ:
	var brain = Organ.new({"id": "Brain", "volume": 0.00127387943212})
	var head = Organ.new({"id": "Head", "volume": 0.04119239747524})
	var eyeR = Organ.new({"id": "EyeR", "name": "Right Eye", "volume": 0.0000923661064})
	var eyeL = Organ.new({"id": "EyeL", "name": "Left Eye", "volume": 0.0000923661064})
	var earR = Organ.new({"id": "EarR", "name": "Right Ear", "volume": 0.00010917393956})
	var earL = Organ.new({"id": "EarL", "name": "Left Ear", "volume": 0.00010917393956})
	var mouth = Organ.new({"id": "Mouth", "volume": 0.00026071682805})
	var nose = Organ.new({"id": "Nose", "volume": 0.00007716972323})
	
	var neck = Organ.new({"id": "Neck", "volume": 0.00051674747374})
	var torsoU = Organ.new({"id": "TorsoU", "name": "Upper Torso", "volume": 0.07289374619722})
	var heart = Organ.new({"id": "Heart", "volume": 0.00061203143559})
	var lungR = Organ.new({"id": "LungR", "name": "Right Lung", "volume": 0.00409334106371})
	var lungL = Organ.new({"id": "LungL", "name": "Left Lung", "volume": 0.00409334525466})
	var stomach = Organ.new({"id": "Stomach", "volume": 0.00044758911827})
	var liver = Organ.new({"id": "Liver", "volume": 0.00147630751599})
	var spleen = Organ.new({"id": "Spleen", "volume": 0.00014384483802})
	var pancreas = Organ.new({"id": "Pancreas", "volume":  0.00009726657299})
	
	var armRU = Organ.new({"id": "ArmRU", "name": "Right Upper Arm", "volume": 0.00300435884856})
	var armRL = Organ.new({"id": "ArmRL", "name": "Right Lower Arm", "volume": 0.003882199293})
	var handR = Organ.new({"id": "HandR", "name": "Right Hand", "volume": 0.00218579918146})
	var thumbR = Organ.new({"id": "ThumbR", "name": "Right Thumb", "volume": 0.00009846345347})
	var fingerR1 = Organ.new({"id": "FingerR1", "name": "Finger", "volume": 0.00015331352188})
	var fingerR2 = Organ.new({"id": "FingerR2", "name": "Finger", "volume": 0.00015331352188})
	var fingerR3 = Organ.new({"id": "FingerR3", "name": "Finger", "volume": 0.00015331352188})
	var fingerR4 = Organ.new({"id": "FingerR4", "name": "Pinky", "volume": 0.00015331352188})
	
	var armLU = Organ.new({"id": "ArmLU", "name": "Left Upper Arm", "volume": 0.00300435884856})
	var armLL = Organ.new({"id": "ArmLL", "name": "Left Lower Arm", "volume": 0.003882199293})
	var handL = Organ.new({"id": "HandL", "name": "Left Hand", "volume": 0.00218579918146})
	var thumbL = Organ.new({"id": "ThumbL", "name": "Left Thumb", "volume": 0.00009846345347})
	var fingerL1 = Organ.new({"id": "FingerL1", "name": "Finger", "volume": 0.00015331352188})
	var fingerL2 = Organ.new({"id": "FingerL2", "name": "Finger", "volume": 0.00015331352188})
	var fingerL3 = Organ.new({"id": "FingerL3", "name": "Finger", "volume": 0.00015331352188})
	var fingerL4 = Organ.new({"id": "FingerL4", "name": "Pinky", "volume": 0.00015331352188})
	
	var torsoL = Organ.new({"id": "TorsoL", "name": "Lower Torso", "volume": 0.02879198081791})
	var kidneyL = Organ.new({"id": "Left Kidney", "volume": 0.00014577648835})
	var kidneyR = Organ.new({"id": "Right Kidney", "volume": 0.00013417842274})
	var guts = Organ.new({"id": "Guts", "volume": 0.00700118485838})
	
	var legRU = Organ.new({"id": "LegRU", "name": "Right Upper Leg", "volume": 0.00600656634197})
	var legRL = Organ.new({"id": "LegRL", "name": "Right Lower Leg", "volume": 0.00980964675546})
	var footR = Organ.new({"id": "FootR", "name": "Right Foot", "volume": 0.00232410663739})
	var toeR1 = Organ.new({"id": "ToeR1", "name": "Toe", "volume": 0.00002738583316})
	var toeR2 = Organ.new({"id": "ToeR2", "name": "Toe", "volume": 0.00002738583316})
	var toeR3 = Organ.new({"id": "ToeR3", "name": "Toe", "volume": 0.00002738583316})
	var toeR4 = Organ.new({"id": "ToeR4", "name": "Toe", "volume": 0.00002738583316})
	var toeR5 = Organ.new({"id": "ToeR5", "name": "Toe", "volume": 0.00002738583316})
	
	var legLU = Organ.new({"id": "LegLU", "name": "Left Upper Leg", "volume": 0.00600656680763})
	var legLL = Organ.new({"id": "LegLL", "name": "Left Lower Leg", "volume": 0.00980964768678})
	var footL = Organ.new({"id": "FootL", "name": "Left Foot", "volume": 0.00232410663739})
	var toeL2 = Organ.new({"id": "ToeL1", "name": "Toe", "volume": 0.00002738583316})
	var toeL1 = Organ.new({"id": "ToeL2", "name": "Toe", "volume": 0.00002738583316})
	var toeL3 = Organ.new({"id": "ToeL3", "name": "Toe", "volume": 0.00002738583316})
	var toeL4 = Organ.new({"id": "ToeL4", "name": "Toe", "volume": 0.00002738583316})
	var toeL5 = Organ.new({"id": "ToeL5", "name": "Toe", "volume": 0.00002738583316})
	
	# Brain, Head, Neck, [Torso], [Arm], [Hand], [Leg], [Foot]
	var humanCritical = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
		"artery": 1.0,
	}
	# Eye, Mouth, Finger, Thumb, Toe
	var humanExtremity = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
	}
	# Ear, Nose
	var humanMayWiggle = {
		"tissue": 1.0,
		"muscle": 0.2, # influence by genetics or random chance
		"nerve": 1.0,
	}
	# Stomach, Liver, Spleen, Pancreas
	var humanOrgan = {
		"tissue": 1.0,
	}
	# Heart, Lung, Guts
	var humanMuscleOrgan = { 
		"tissue": 1.0,
		"muscle": 1.0,
		"artery": 1.0,
	}
	
	# start connecting from root of the creature, the brain
	brain.isBrainOf(head, humanCritical)
	
	# each organ has it's own block of connecting other organs
	head.connectOrgan(eyeR, humanExtremity)
	head.connectOrgan(eyeL, humanExtremity)
	head.connectOrgan(earR, humanMayWiggle)
	head.connectOrgan(earL, humanMayWiggle)
	head.connectOrgan(nose, humanMayWiggle)
	head.connectOrgan(mouth, humanExtremity)
	head.connectOrgan(neck, humanCritical)
	
	neck.connectOrgan(torsoU, humanCritical)
	
	torsoU.connectOrgan(heart, humanMuscleOrgan)
	heart.isHeart = true
	torsoU.connectOrgan(lungR, humanMuscleOrgan)
	torsoU.connectOrgan(lungL, humanMuscleOrgan)
	torsoU.connectOrgan(stomach, humanOrgan)
	torsoU.connectOrgan(liver, humanOrgan)
	torsoU.connectOrgan(spleen, humanOrgan)
	torsoU.connectOrgan(pancreas, humanOrgan)
	torsoU.connectOrgan(armRU, humanCritical)
	torsoU.connectOrgan(armLU, humanCritical)
	torsoU.connectOrgan(torsoL, humanCritical)
	
	armRU.connectOrgan(armRL, humanCritical)
	
	armRL.connectOrgan(handR, humanCritical)
	
	handR.connectOrgan(thumbR, humanExtremity)
	handR.connectOrgan(fingerR1, humanExtremity)
	handR.connectOrgan(fingerR2, humanExtremity)
	handR.connectOrgan(fingerR3, humanExtremity)
	handR.connectOrgan(fingerR4, humanExtremity)
	
	armLU.connectOrgan(armLL, humanCritical)
	
	armLL.connectOrgan(handL, humanCritical)
	
	handL.connectOrgan(thumbL, humanExtremity)
	handL.connectOrgan(fingerL1, humanExtremity)
	handL.connectOrgan(fingerL2, humanExtremity)
	handL.connectOrgan(fingerL3, humanExtremity)
	handL.connectOrgan(fingerL4, humanExtremity)
	
	torsoL.connectOrgan(guts, humanMuscleOrgan)
	torsoL.connectOrgan(kidneyR, humanOrgan)
	torsoL.connectOrgan(kidneyL, humanOrgan)
	torsoL.connectOrgan(legRU, humanCritical)
	torsoL.connectOrgan(legLU, humanCritical)
	
	legRU.connectOrgan(legRL, humanCritical)
	
	legRL.connectOrgan(footR, humanCritical)

	footR.connectOrgan(toeR1, humanExtremity)
	footR.connectOrgan(toeR2, humanExtremity)
	footR.connectOrgan(toeR3, humanExtremity)
	footR.connectOrgan(toeR4, humanExtremity)
	footR.connectOrgan(toeR5, humanExtremity)
	
	legLU.connectOrgan(legLL, humanCritical)
	
	legLL.connectOrgan(footL, humanCritical)
	
	footL.connectOrgan(toeL1, humanExtremity)
	footL.connectOrgan(toeL2, humanExtremity)
	footL.connectOrgan(toeL3, humanExtremity)
	footL.connectOrgan(toeL4, humanExtremity)
	footL.connectOrgan(toeL5, humanExtremity)
	
	return brain

func _ready() -> void:
	print("\n==Starting Organ Test==\n")
	var humanBrain: Organ = constructHuman()
	
	var body = completeBody(humanBrain)
	var organs: Array[Organ] = body.getAllOrgans()
	organs.sort_custom(
		func(organA: Organ, organB: Organ): return organA.volume > organB.volume
	)
	for organ in organs:
		print("%s\n%s m^3\n%s cm^3" % [organ.name, organ.volume, organ.volume*1000000])

	print(JSON.stringify(getBodyData(humanBrain), "	"))
	
	
func getBodyData(rootOrgan: Organ) -> Dictionary:
	var bodyData: Dictionary = {}
	bodyData = rootOrgan.getInfo()
	var connectionData = {
		"internal": [],
		"external": []
	}
	for connection in rootOrgan.connections:
		var nextOrgan = connection.linkTo
		var curConnData = {
			"connection": connection.getInfo(),
			"_organ": getBodyData(nextOrgan)
		}
		if connection in rootOrgan.internalConnections:
			connectionData.internal.push_back(curConnData)
		else:
			connectionData.external.push_back(curConnData)
	
	bodyData["ZZconnections"] = connectionData
	return bodyData
